# FirstLight Python Worker — honest scaffold edition (round 4).
#
# REALITY (do not paper over this): the raster/ML processing this worker is
# designed for is NOT implemented. The previous version fabricated output
# URLs for files that were never written, invented quality metrics with
# random.uniform(), and slept to simulate processing time. That is exactly
# the dishonesty the rereview called out, so every unimplemented task now
# returns `status: "blocked_scaffold"` with the exact missing dependency
# named — no URLs, no metrics, no simulated latency. The orchestration
# layer and UI must surface these as BLOCKED capabilities, never as
# completed products.
#
# What IS real in this module:
#   - secure_download.download_file: the full hardened egress policy
#     (HTTPS-only, allowlist, SSRF/DNS guards, redirect + byte limits,
#     content-type + checksum verification, atomic temp files) — unit-tested
#     in test_secure_download.py,
#   - health_check: genuine process/system telemetry + capability truth,
#   - upload_to_s3 / generate_output_path: seams kept for the first real
#     vertical slice (asset → download → COG/NDVI → checksum → catalog).
#
# The first real vertical slice (roadmap): Sentinel-2 metadata → secure
# download of a test raster → COG/NDVI via rasterio → sha256 → catalog
# record. Until that lands, tasks stay blocked_scaffold.

import os
import logging
from typing import Dict, Any, Tuple
from datetime import datetime, timezone

from celery import Celery
from celery.utils.log import get_task_logger

from secure_download import download_file as secure_download_file

logger = get_task_logger(__name__)

REDIS_URL = os.getenv('REDIS_URL', 'redis://redis:6379/0')
app = Celery(
    'firstlight_worker',
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=['tasks'],
)

app.conf.task_routes = {
    'tasks.process_sar_image': {'queue': 'raster'},
    'tasks.process_optical_image': {'queue': 'raster'},
    'tasks.run_damage_detection': {'queue': 'ml'},
    'tasks.run_flood_detection': {'queue': 'ml'},
    'tasks.compute_exposure': {'queue': 'processing'},
    'tasks.generate_cog': {'queue': 'raster'},
    'tasks.compute_indices': {'queue': 'raster'},
}
app.conf.task_default_queue = 'processing'
app.conf.task_default_exchange = 'firstlight'
app.conf.task_default_routing_key = 'processing'
app.conf.task_serializer = 'json'
app.conf.result_serializer = 'json'
app.conf.accept_content = ['json']
app.conf.timezone = 'UTC'
app.conf.enable_utc = True

# ============================================================================
# Scaffolding registry — the single source of "what is actually missing"
# ============================================================================

#: task name -> exact missing dependency (surfaced to orchestrator + UI).
SCAFFOLD_BLOCKED_BY: Dict[str, str] = {
    'process_sar_image': 'SAR radiometric-terrain-correction implementation (rasterio + sentinel1-rtc recipes) is not implemented',
    'process_optical_image': 'optical preprocessing pipeline (rasterio, L1C->L2A, cloud masking) is not implemented',
    'generate_cog': 'COG generation via rasterio/GDAL is not implemented',
    'compute_indices': 'band-math index computation (rasterio) is not implemented',
    'run_damage_detection': 'Siamese-UNet damage model weights + PyTorch inference path are not available',
    'run_flood_detection': 'U-Net flood segmentation model weights + PyTorch inference path are not available',
    'compute_exposure': 'exposure intersection (WorldPop/OSM vectors × hazard polygons) is not implemented',
}


def scaffold_result(task_id: str, task_name: str) -> Dict[str, Any]:
    """The honest answer for an unimplemented capability.

    Deliberately contains NO output URLs, NO metrics, NO quality scores —
    nothing an upstream system could mistake for a completed product.
    """
    blocked_by = SCAFFOLD_BLOCKED_BY[task_name]
    return {
        'task_id': task_id,
        'task': task_name,
        'status': 'blocked_scaffold',
        'blocked_by': blocked_by,
        'message': (
            f'{task_name} is scaffolding, not an implemented capability. '
            f'{blocked_by}. No outputs were produced and none are claimed.'
        ),
        'outputs': None,
        'metrics': None,
        'timestamp': datetime.now(timezone.utc).isoformat(),
    }


# ============================================================================
# Utility seams (real where marked)
# ============================================================================

def download_file(url: str, destination: str) -> Tuple[bool, str]:
    """REAL: hardened download under the full egress policy (see
    secure_download.py). Kept as the seam the future vertical slice uses."""
    return secure_download_file(url, destination)


def upload_to_s3(file_path: str, s3_url: str) -> Tuple[bool, str]:
    """Seam (unused by scaffold tasks): upload to S3-compatible storage."""
    try:
        import boto3
        from urllib.parse import urlparse

        parsed = urlparse(s3_url)
        bucket = parsed.netloc
        key = parsed.path.lstrip('/')
        s3 = boto3.client(
            's3',
            endpoint_url=os.getenv('S3_ENDPOINT_URL', 'http://minio:9000'),
            aws_access_key_id=os.getenv('S3_ACCESS_KEY', ''),
            aws_secret_access_key=os.getenv('S3_SECRET_KEY', ''),
        )
        s3.upload_file(file_path, bucket, key)
        return True, s3_url
    except Exception as e:
        logger.error('Failed to upload to S3 (endpoint configured, path redacted)')
        return False, type(e).__name__


def generate_output_path(task_id: str, filename: str) -> str:
    """Seam (unused by scaffold tasks): output object key convention."""
    return f's3://firstlight-outputs/{task_id}/{filename}'


# ============================================================================
# Tasks — every unimplemented capability answers blocked_scaffold
# ============================================================================

@app.task(bind=True, max_retries=0)
def process_sar_image(self, task_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """SAR processing — SCAFFOLD (blocked). See SCAFFOLD_BLOCKED_BY."""
    logger.info('process_sar_image blocked_scaffold: %s', task_id)
    return scaffold_result(task_id, 'process_sar_image')


@app.task(bind=True, max_retries=0)
def process_optical_image(self, task_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """Optical processing — SCAFFOLD (blocked). See SCAFFOLD_BLOCKED_BY."""
    logger.info('process_optical_image blocked_scaffold: %s', task_id)
    return scaffold_result(task_id, 'process_optical_image')


@app.task(bind=True, max_retries=0)
def generate_cog(self, task_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """COG generation — SCAFFOLD (blocked). See SCAFFOLD_BLOCKED_BY."""
    logger.info('generate_cog blocked_scaffold: %s', task_id)
    return scaffold_result(task_id, 'generate_cog')


@app.task(bind=True, max_retries=0)
def compute_indices(self, task_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """Index computation — SCAFFOLD (blocked). See SCAFFOLD_BLOCKED_BY."""
    logger.info('compute_indices blocked_scaffold: %s', task_id)
    return scaffold_result(task_id, 'compute_indices')


@app.task(bind=True, max_retries=0)
def run_damage_detection(self, task_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """Damage detection — SCAFFOLD (blocked, model weights unavailable)."""
    logger.info('run_damage_detection blocked_scaffold: %s', task_id)
    return scaffold_result(task_id, 'run_damage_detection')


@app.task(bind=True, max_retries=0)
def run_flood_detection(self, task_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """Flood detection — SCAFFOLD (blocked, model weights unavailable)."""
    logger.info('run_flood_detection blocked_scaffold: %s', task_id)
    return scaffold_result(task_id, 'run_flood_detection')


@app.task(bind=True, max_retries=0)
def compute_exposure(self, task_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """Exposure intersection — SCAFFOLD (blocked). See SCAFFOLD_BLOCKED_BY."""
    logger.info('compute_exposure blocked_scaffold: %s', task_id)
    return scaffold_result(task_id, 'compute_exposure')


@app.task(bind=True, max_retries=0)
def process_batch(self, task_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """Dispatch a batch — items propagate their true (blocked) statuses."""
    task_type = params.get('task_type', 'optical')
    items = params.get('items', [])
    dispatch = {
        'sar': process_sar_image,
        'optical': process_optical_image,
        'damage': run_damage_detection,
        'flood': run_flood_detection,
    }
    runner = dispatch.get(task_type, compute_indices)

    results = []
    for i, item in enumerate(items):
        sub = runner.apply(args=[f'{task_id}-{i}', item]).get()
        results.append({
            'item_index': i,
            'status': sub.get('status', 'unknown'),
            'blocked_by': sub.get('blocked_by'),
        })

    return {
        'task_id': task_id,
        'task': 'process_batch',
        'status': 'blocked_scaffold' if results else 'completed',
        'blocked_by': (
            'all sub-tasks are scaffolding — see per-item blocked_by'
            if results else None
        ),
        'items': results,
        'outputs': None,
        'metrics': None,
        'timestamp': datetime.now(timezone.utc).isoformat(),
    }


@app.task(bind=True, max_retries=0)
def health_check() -> Dict[str, Any]:
    """REAL process health + capability truth in one payload.

    The worker PROCESS reports healthy (telemetry is genuine), while
    `capabilities` states per-task implementation status so no orchestration
    layer can mistake scaffolding for a working pipeline.
    """
    import platform

    payload: Dict[str, Any] = {
        'status': 'healthy',
        'worker': 'firstlight-python-worker',
        'version': '2.0.0-scaffold-honest',
        'queues': ['raster', 'ml', 'processing'],
        'capabilities': {
            name: 'blocked_scaffold' for name in SCAFFOLD_BLOCKED_BY
        },
        'capabilities_note': (
            'No raster/ML task is implemented; every task returns '
            'blocked_scaffold with its missing dependency. The hardened '
            'secure_download egress policy is real and unit-tested.'
        ),
        'system': {
            'hostname': platform.node(),
            'python_version': platform.python_version(),
        },
        'timestamp': datetime.now(timezone.utc).isoformat(),
    }

    try:
        import psutil
        payload['system'].update({
            'cpu_usage_percent': psutil.cpu_percent(interval=1),
            'memory_usage_percent': psutil.virtual_memory().percent,
            'disk_usage_percent': psutil.disk_usage('/').percent,
        })
    except Exception:
        payload['system']['telemetry'] = 'psutil unavailable'

    return payload


if __name__ == '__main__':
    app.main()
