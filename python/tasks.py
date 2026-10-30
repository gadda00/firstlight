# FirstLight Python Worker - Celery Tasks
# Raster processing, ML inference, and heavy computation

import os
import json
import logging
import tempfile
import numpy as np
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime

from celery import Celery
from celery.utils.log import get_task_logger

# Configure logging
logger = get_task_logger(__name__)

# Configure Celery
REDIS_URL = os.getenv('REDIS_URL', 'redis://redis:6379/0')
app = Celery(
    'firstlight_worker',
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=['tasks'],
)

# Configure task routes
app.conf.task_routes = {
    'tasks.process_sar_image': {'queue': 'raster'},
    'tasks.process_optical_image': {'queue': 'raster'},
    'tasks.run_damage_detection': {'queue': 'ml'},
    'tasks.run_flood_detection': {'queue': 'ml'},
    'tasks.compute_exposure': {'queue': 'processing'},
    'tasks.generate_cog': {'queue': 'raster'},
    'tasks.compute_indices': {'queue': 'raster'},
}

# Configure task defaults
app.conf.task_default_queue = 'processing'
app.conf.task_default_exchange = 'firstlight'
app.conf.task_default_routing_key = 'processing'
app.conf.task_serializer = 'json'
app.conf.result_serializer = 'json'
app.conf.accept_content = ['json']
app.conf.timezone = 'UTC'
app.conf.enable_utc = True

# ============================================================================
# Utility Functions
# ============================================================================

def download_file(url: str, destination: str) -> Tuple[bool, str]:
    """Download a file from URL to destination path."""
    import requests
    
    try:
        # Check if URL is S3
        if url.startswith('s3://'):
            # Use boto3 for S3
            import boto3
            from urllib.parse import urlparse
            
            parsed = urlparse(url)
            bucket = parsed.netloc
            key = parsed.path.lstrip('/')
            
            s3 = boto3.client(
                's3',
                endpoint_url=os.getenv('S3_ENDPOINT_URL', 'http://minio:9000'),
                aws_access_key_id=os.getenv('S3_ACCESS_KEY', 'minioadmin'),
                aws_secret_access_key=os.getenv('S3_SECRET_KEY', 'minioadmin'),
            )
            
            s3.download_file(bucket, key, destination)
            return True, destination
        else:
            # HTTP/HTTPS download
            response = requests.get(url, stream=True, timeout=300)
            response.raise_for_status()
            
            with open(destination, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            return True, destination
            
    except Exception as e:
        logger.error(f"Failed to download {url}: {str(e)}")
        return False, str(e)


def upload_to_s3(file_path: str, s3_url: str) -> Tuple[bool, str]:
    """Upload a file to S3-compatible storage."""
    try:
        import boto3
        from urllib.parse import urlparse
        
        parsed = urlparse(s3_url)
        bucket = parsed.netloc
        key = parsed.path.lstrip('/')
        
        s3 = boto3.client(
            's3',
            endpoint_url=os.getenv('S3_ENDPOINT_URL', 'http://minio:9000'),
            aws_access_key_id=os.getenv('S3_ACCESS_KEY', 'minioadmin'),
            aws_secret_access_key=os.getenv('S3_SECRET_KEY', 'minioadmin'),
        )
        
        s3.upload_file(file_path, bucket, key)
        return True, s3_url
        
    except Exception as e:
        logger.error(f"Failed to upload to {s3_url}: {str(e)}")
        return False, str(e)


def generate_output_path(task_id: str, filename: str) -> str:
    """Generate S3 output path for a task."""
    return f"s3://firstlight-outputs/{task_id}/{filename}"


# ============================================================================
# SAR Processing Tasks
# ============================================================================

@app.task(bind=True, max_retries=3, default_retry_delay=60)
def process_sar_image(self, task_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process SAR (Synthetic Aperture Radar) imagery.
    
    Args:
        task_id: Unique task identifier
        params: Processing parameters including:
            - url: S3 URL or HTTP URL of the SAR image
            - polarization: Polarization (VV, VH, HH, HV)
            - processing_level: Level of processing (RTC, GRD, SLC)
            - aoi: Area of interest (GeoJSON polygon)
            - output_format: Output format (COG, GeoTIFF)
    
    Returns:
        Result dictionary with processing metadata and output URLs
    """
    import tempfile
    import time
    
    logger.info(f"Processing SAR image: {task_id}")
    start_time = time.time()
    
    try:
        # Create temporary directory
        with tempfile.TemporaryDirectory() as tmpdir:
            input_path = os.path.join(tmpdir, 'input.tif')
            output_path = os.path.join(tmpdir, 'output.tif')
            
            # Download input file
            download_success, download_msg = download_file(params['url'], input_path)
            if not download_success:
                raise Exception(f"Failed to download SAR image: {download_msg}")
            
            # Get file info
            input_size = os.path.getsize(input_path)
            
            # TODO: Implement actual SAR processing using PyTorch/rasterio
            # For now, we'll simulate the processing
            
            # Simulate processing time
            import random
            processing_time = random.uniform(60, 180)
            time.sleep(min(processing_time * 0.1, 10))  # 10% of processing time
            
            # Generate mock output
            output_url = generate_output_path(task_id, 'sar_processed.cog.tif')
            thumbnail_url = generate_output_path(task_id, 'sar_thumbnail.png')
            metadata_url = generate_output_path(task_id, 'sar_metadata.json')
            
            # Calculate output size (simulated compression)
            output_size = int(input_size * 0.7)
            
            result = {
                'task_id': task_id,
                'status': 'completed',
                'params': params,
                'outputs': {
                    'processed': output_url,
                    'thumbnail': thumbnail_url,
                    'metadata': metadata_url,
                },
                'metrics': {
                    'processing_time_seconds': round(processing_time, 2),
                    'input_size_bytes': input_size,
                    'output_size_bytes': output_size,
                    'compression_ratio': round(output_size / input_size, 4) if input_size > 0 else 0,
                },
                'quality': {
                    'processing_level': params.get('processing_level', 'GRD'),
                    'polarization': params.get('polarization', 'VV'),
                    'snr_estimated': round(random.uniform(20, 35), 2),
                    'coverage_percentage': round(random.uniform(95, 100), 2),
                },
                'timestamp': datetime.utcnow().isoformat() + 'Z',
            }
            
            logger.info(f"SAR processing completed: {task_id}")
            return result
            
    except Exception as e:
        logger.error(f"SAR processing failed: {task_id}, error: {str(e)}")
        raise self.retry(exc=e, countdown=60)


# ============================================================================
# Optical Image Processing Tasks
# ============================================================================

@app.task(bind=True, max_retries=3, default_retry_delay=60)
def process_optical_image(self, task_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process optical imagery (Sentinel-2, Landsat, etc.).
    
    Args:
        task_id: Unique task identifier
        params: Processing parameters including:
            - url: S3 URL or HTTP URL of the optical image
            - bands: List of bands to process
            - cloud_mask: Whether to apply cloud masking
            - atmospheric_correction: Type of atmospheric correction
            - aoi: Area of interest (GeoJSON polygon)
    
    Returns:
        Result dictionary with processing metadata and output URLs
    """
    import tempfile
    import time
    
    logger.info(f"Processing optical image: {task_id}")
    start_time = time.time()
    
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            input_path = os.path.join(tmpdir, 'input.tif')
            
            # Download input file
            download_success, download_msg = download_file(params['url'], input_path)
            if not download_success:
                raise Exception(f"Failed to download optical image: {download_msg}")
            
            input_size = os.path.getsize(input_path)
            
            # TODO: Implement actual optical processing
            # Steps:
            # 1. Apply atmospheric correction
            # 2. Apply cloud masking (if requested)
            # 3. Compute vegetation indices
            # 4. Generate COG
            
            import random
            processing_time = random.uniform(45, 120)
            time.sleep(min(processing_time * 0.1, 5))
            
            # Generate output URLs
            ndvi_url = generate_output_path(task_id, 'ndvi.tif')
            ndwi_url = generate_output_path(task_id, 'ndwi.tif')
            cloud_mask_url = generate_output_path(task_id, 'cloud_mask.tif')
            false_color_url = generate_output_path(task_id, 'false_color.tif')
            thumbnail_url = generate_output_path(task_id, 'optical_thumbnail.png')
            
            output_size = int(input_size * 0.5)
            cloud_coverage = round(random.uniform(0, 30), 2)
            
            result = {
                'task_id': task_id,
                'status': 'completed',
                'params': params,
                'outputs': {
                    'ndvi': ndvi_url,
                    'ndwi': ndwi_url,
                    'cloud_mask': cloud_mask_url,
                    'false_color': false_color_url,
                    'thumbnail': thumbnail_url,
                },
                'metrics': {
                    'processing_time_seconds': round(processing_time, 2),
                    'input_size_bytes': input_size,
                    'output_size_bytes': output_size,
                    'cloud_coverage_percentage': cloud_coverage,
                },
                'quality': {
                    'bands_processed': params.get('bands', ['B02', 'B03', 'B04', 'B08']),
                    'atmospheric_correction': params.get('atmospheric_correction', 'SENTINEL2_L2A'),
                    'cloud_mask_accuracy': round(random.uniform(0.85, 0.98), 4),
                },
                'timestamp': datetime.utcnow().isoformat() + 'Z',
            }
            
            logger.info(f"Optical processing completed: {task_id}")
            return result
            
    except Exception as e:
        logger.error(f"Optical processing failed: {task_id}, error: {str(e)}")
        raise self.retry(exc=e, countdown=60)


# ============================================================================
# Cloud-Optimized GeoTIFF Generation
# ============================================================================

@app.task(bind=True, max_retries=2, default_retry_delay=30)
def generate_cog(self, task_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate Cloud-Optimized GeoTIFF (COG) from input raster.
    
    Args:
        task_id: Unique task identifier
        params: Parameters including:
            - input_url: URL of input raster
            - output_format: COG profile (deflate, lzw, etc.)
            - resampling: Resampling method
            - overview_levels: Overview levels to generate
    
    Returns:
        Result dictionary with COG metadata
    """
    import tempfile
    import time
    
    logger.info(f"Generating COG: {task_id}")
    start_time = time.time()
    
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            input_path = os.path.join(tmpdir, 'input.tif')
            output_path = os.path.join(tmpdir, 'output.cog.tif')
            
            # Download input
            download_success, download_msg = download_file(params['input_url'], input_path)
            if not download_success:
                raise Exception(f"Failed to download input: {download_msg}")
            
            input_size = os.path.getsize(input_path)
            
            # TODO: Implement COG generation using rasterio
            # import rasterio
            # from rasterio.shutil import copy
            # 
            # with rasterio.open(input_path) as src:
            #     profile = src.profile.copy()
            #     profile.update(
            #         tiled=True,
            #         blockxsize=512,
            #         blockysize=512,
            #         compress='deflate',
            #         predictor=2,
            #     )
            #     
            #     with rasterio.open(output_path, 'w', **profile) as dst:
            #         for i in src.indexes:
            #             copy(src, dst, i, **{'resampling': src.resampling})
            
            import random
            processing_time = random.uniform(15, 45)
            time.sleep(min(processing_time * 0.1, 3))
            
            output_url = generate_output_path(task_id, 'output.cog.tif')
            output_size = int(input_size * 0.8)
            compression_ratio = round(output_size / input_size, 4) if input_size > 0 else 0
            
            result = {
                'task_id': task_id,
                'status': 'completed',
                'params': params,
                'outputs': {
                    'cog': output_url,
                },
                'metrics': {
                    'processing_time_seconds': round(processing_time, 2),
                    'input_size_bytes': input_size,
                    'output_size_bytes': output_size,
                    'compression_ratio': compression_ratio,
                },
                'quality': {
                    'profile': params.get('output_format', 'deflate'),
                    'resampling': params.get('resampling', 'nearest'),
                    'overview_levels': params.get('overview_levels', [2, 4, 8, 16]),
                },
                'timestamp': datetime.utcnow().isoformat() + 'Z',
            }
            
            logger.info(f"COG generation completed: {task_id}")
            return result
            
    except Exception as e:
        logger.error(f"COG generation failed: {task_id}, error: {str(e)}")
        raise self.retry(exc=e, countdown=30)


# ============================================================================
# Index Computation
# ============================================================================

@app.task(bind=True, max_retries=2, default_retry_delay=30)
def compute_indices(self, task_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compute spectral indices from multi-band imagery.
    
    Args:
        task_id: Unique task identifier
        params: Parameters including:
            - input_url: URL of input multi-band raster
            - indices: List of indices to compute (ndvi, ndwi, ndbi, etc.)
            - aoi: Area of interest
    
    Returns:
        Result dictionary with index values and metadata
    """
    import tempfile
    import time
    import random
    
    logger.info(f"Computing indices: {task_id}")
    start_time = time.time()
    
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            input_path = os.path.join(tmpdir, 'input.tif')
            
            # Download input
            download_success, download_msg = download_file(params['input_url'], input_path)
            if not download_success:
                raise Exception(f"Failed to download input: {download_msg}")
            
            input_size = os.path.getsize(input_path)
            
            # TODO: Implement actual index computation using rasterio
            # import rasterio
            # import numpy as np
            # 
            # with rasterio.open(input_path) as src:
            #     data = src.read()
            #     profile = src.profile
            # 
            #     # Compute indices
            #     if 'ndvi' in indices:
            #         nir = data[3]  # B08
            #         red = data[2]  # B04
            #         ndvi = (nir - red) / (nir + red + 1e-10)
            #         # Save NDVI
            # 
            processing_time = random.uniform(10, 30)
            time.sleep(min(processing_time * 0.1, 2))
            
            # Generate mock index results
            indices = params.get('indices', ['ndvi', 'ndwi', 'ndbi', 'savi'])
            index_results = {}
            
            for idx in indices:
                index_results[idx] = {
                    'min': round(random.uniform(-0.2, 0.1), 4),
                    'max': round(random.uniform(0.6, 0.95), 4),
                    'mean': round(random.uniform(0.3, 0.7), 4),
                    'std': round(random.uniform(0.05, 0.2), 4),
                    'median': round(random.uniform(0.25, 0.65), 4),
                    'url': generate_output_path(task_id, f'{idx}.tif'),
                }
            
            result = {
                'task_id': task_id,
                'status': 'completed',
                'params': params,
                'outputs': index_results,
                'metrics': {
                    'processing_time_seconds': round(processing_time, 2),
                    'input_size_bytes': input_size,
                    'indices_computed': len(indices),
                },
                'quality': {
                    'index_quality': 'high',
                    'cloud_mask_applied': params.get('cloud_mask', False),
                },
                'timestamp': datetime.utcnow().isoformat() + 'Z',
            }
            
            logger.info(f"Index computation completed: {task_id}")
            return result
            
    except Exception as e:
        logger.error(f"Index computation failed: {task_id}, error: {str(e)}")
        raise self.retry(exc=e, countdown=30)


# ============================================================================
# ML Inference Tasks
# ============================================================================

@app.task(bind=True, max_retries=2, default_retry_delay=60)
def run_damage_detection(self, task_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run building damage detection ML model.
    
    Args:
        task_id: Unique task identifier
        params: Parameters including:
            - pre_event_url: URL of pre-event imagery
            - post_event_url: URL of post-event imagery
            - model: Model to use (default: 'sar-damage-v1')
            - confidence_threshold: Minimum confidence for detection
            - aoi: Area of interest
    
    Returns:
        Result dictionary with damage detection results
    """
    import tempfile
    import time
    import random
    
    logger.info(f"Running damage detection: {task_id}")
    start_time = time.time()
    
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            pre_path = os.path.join(tmpdir, 'pre.tif')
            post_path = os.path.join(tmpdir, 'post.tif')
            
            # Download inputs
            download_file(params['pre_event_url'], pre_path)
            download_file(params['post_event_url'], post_path)
            
            # TODO: Implement damage detection using PyTorch
            # import torch
            # from torchvision import transforms
            # 
            # # Load model
            # model = torch.load('damage_model.pth')
            # model.eval()
            # 
            # # Preprocess images
            # # Run inference
            # # Post-process
            
            processing_time = random.uniform(120, 240)
            time.sleep(min(processing_time * 0.1, 15))
            
            # Generate mock results
            total_buildings = random.randint(800, 2000)
            damaged_buildings = random.randint(50, 500)
            damage_percentage = round((damaged_buildings / total_buildings) * 100, 2)
            
            # Damage distribution
            none_count = total_buildings - damaged_buildings
            minor_count = int(damaged_buildings * 0.4)
            major_count = int(damaged_buildings * 0.4)
            destroyed_count = damaged_buildings - minor_count - major_count
            
            result = {
                'task_id': task_id,
                'status': 'completed',
                'params': params,
                'outputs': {
                    'damage_map': generate_output_path(task_id, 'damage_map.geojson'),
                    'confidence_map': generate_output_path(task_id, 'confidence_map.tif'),
                    'summary': generate_output_path(task_id, 'damage_summary.json'),
                    'thumbnail': generate_output_path(task_id, 'damage_thumbnail.png'),
                    'change_map': generate_output_path(task_id, 'change_map.tif'),
                },
                'metrics': {
                    'processing_time_seconds': round(processing_time, 2),
                    'buildings_detected': total_buildings,
                    'buildings_damaged': damaged_buildings,
                    'damage_percentage': damage_percentage,
                    'model_version': params.get('model', 'sar-damage-v1.2.0'),
                    'inference_time_seconds': round(processing_time * 0.7, 2),
                },
                'class_distribution': {
                    'none': none_count,
                    'minor': minor_count,
                    'major': major_count,
                    'destroyed': destroyed_count,
                },
                'quality': {
                    'confidence_threshold': params.get('confidence_threshold', 0.7),
                    'average_confidence': round(random.uniform(0.75, 0.95), 4),
                    'precision': round(random.uniform(0.8, 0.95), 4),
                    'recall': round(random.uniform(0.75, 0.9), 4),
                },
                'timestamp': datetime.utcnow().isoformat() + 'Z',
            }
            
            logger.info(f"Damage detection completed: {task_id}")
            return result
            
    except Exception as e:
        logger.error(f"Damage detection failed: {task_id}, error: {str(e)}")
        raise self.retry(exc=e, countdown=60)


@app.task(bind=True, max_retries=2, default_retry_delay=60)
def run_flood_detection(self, task_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run flood detection ML model.
    
    Args:
        task_id: Unique task identifier
        params: Parameters including:
            - input_url: URL of SAR or optical imagery
            - model: Model to use (default: 'flood-unet-v1')
            - water_threshold: Threshold for water classification
            - aoi: Area of interest
    
    Returns:
        Result dictionary with flood detection results
    """
    import tempfile
    import time
    import random
    
    logger.info(f"Running flood detection: {task_id}")
    start_time = time.time()
    
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            input_path = os.path.join(tmpdir, 'input.tif')
            
            # Download input
            download_success, download_msg = download_file(params['input_url'], input_path)
            if not download_success:
                raise Exception(f"Failed to download input: {download_msg}")
            
            input_size = os.path.getsize(input_path)
            
            # TODO: Implement flood detection using U-Net
            # import torch
            # import numpy as np
            # 
            # # Load and preprocess image
            # # Run model inference
            # # Post-process to get binary water mask
            
            processing_time = random.uniform(180, 300)
            time.sleep(min(processing_time * 0.1, 18))
            
            # Generate mock results
            total_pixels = random.randint(500000, 2000000)
            water_pixels = random.randint(50000, 500000)
            flood_area_km2 = round(water_pixels * 0.0001 * random.uniform(0.8, 1.2), 2)
            flood_percentage = round((water_pixels / total_pixels) * 100, 2)
            
            result = {
                'task_id': task_id,
                'status': 'completed',
                'params': params,
                'outputs': {
                    'flood_mask': generate_output_path(task_id, 'flood_mask.tif'),
                    'flood_polygons': generate_output_path(task_id, 'flood_polygons.geojson'),
                    'depth_map': generate_output_path(task_id, 'depth_map.tif'),
                    'summary': generate_output_path(task_id, 'flood_summary.json'),
                    'thumbnail': generate_output_path(task_id, 'flood_thumbnail.png'),
                },
                'metrics': {
                    'processing_time_seconds': round(processing_time, 2),
                    'flood_area_km2': flood_area_km2,
                    'flood_area_percentage': flood_percentage,
                    'water_pixels': water_pixels,
                    'total_pixels': total_pixels,
                    'model_version': params.get('model', 'flood-unet-v2.1.0'),
                },
                'depth_distribution': {
                    'shallow_0_0.5m': round(random.uniform(30, 50), 2),
                    'moderate_0.5_1.5m': round(random.uniform(25, 40), 2),
                    'deep_1.5m_plus': round(random.uniform(10, 25), 2),
                },
                'quality': {
                    'water_threshold': params.get('water_threshold', 0.5),
                    'average_confidence': round(random.uniform(0.85, 0.98), 4),
                    'precision': round(random.uniform(0.85, 0.95), 4),
                    'recall': round(random.uniform(0.8, 0.95), 4),
                    'f1_score': round(random.uniform(0.82, 0.95), 4),
                },
                'timestamp': datetime.utcnow().isoformat() + 'Z',
            }
            
            logger.info(f"Flood detection completed: {task_id}")
            return result
            
    except Exception as e:
        logger.error(f"Flood detection failed: {task_id}, error: {str(e)}")
        raise self.retry(exc=e, countdown=60)


# ============================================================================
# Exposure Computation
# ============================================================================

@app.task(bind=True, max_retries=2, default_retry_delay=30)
def compute_exposure(self, task_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compute population and asset exposure to hazards.
    
    Args:
        task_id: Unique task identifier
        params: Parameters including:
            - hazard_url: URL of hazard layer (flood, damage, etc.)
            - population_url: URL of population raster (WorldPop, etc.)
            - asset_url: URL of asset layer (buildings, roads, etc.)
            - method: Dasymetric or overlay method
    
    Returns:
        Result dictionary with exposure statistics
    """
    import tempfile
    import time
    import random
    
    logger.info(f"Computing exposure: {task_id}")
    start_time = time.time()
    
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            hazard_path = os.path.join(tmpdir, 'hazard.tif')
            population_path = os.path.join(tmpdir, 'population.tif')
            asset_path = os.path.join(tmpdir, 'assets.geojson')
            
            # Download inputs
            download_file(params['hazard_url'], hazard_path)
            download_file(params['population_url'], population_path)
            download_file(params['asset_url'], asset_path)
            
            # TODO: Implement exposure computation using rasterio and geopandas
            # import rasterio
            # import geopandas as gpd
            # import numpy as np
            # 
            # # Load hazard mask
            # with rasterio.open(hazard_path) as src:
            #     hazard = src.read(1)
            #     profile = src.profile
            # 
            # # Load population
            # with rasterio.open(population_path) as src:
            #     population = src.read(1)
            # 
            # # Compute exposed population
            # exposed_pop = population[hazard > 0]
            # 
            # # Load assets
            # assets = gpd.read_file(asset_path)
            # # Compute exposed assets
            
            processing_time = random.uniform(60, 120)
            time.sleep(min(processing_time * 0.1, 8))
            
            # Generate mock results
            population_exposed = random.randint(10000, 100000)
            buildings_exposed = random.randint(200, 2000)
            roads_affected = round(random.uniform(50, 300), 1)
            
            result = {
                'task_id': task_id,
                'status': 'completed',
                'params': params,
                'outputs': {
                    'exposure_map': generate_output_path(task_id, 'exposure_map.tif'),
                    'exposure_report': generate_output_path(task_id, 'exposure_report.json'),
                    'exposed_assets': generate_output_path(task_id, 'exposed_assets.geojson'),
                },
                'metrics': {
                    'processing_time_seconds': round(processing_time, 2),
                    'population_exposed': population_exposed,
                    'buildings_exposed': buildings_exposed,
                    'roads_affected_km': roads_affected,
                    'method': params.get('method', 'dasymetric'),
                },
                'exposure_by_zone': {
                    'zone_1': {
                        'population': random.randint(2000, 10000),
                        'buildings': random.randint(50, 200),
                        'roads_km': round(random.uniform(10, 50), 1),
                    },
                    'zone_2': {
                        'population': random.randint(3000, 15000),
                        'buildings': random.randint(80, 300),
                        'roads_km': round(random.uniform(15, 60), 1),
                    },
                    'zone_3': {
                        'population': random.randint(5000, 25000),
                        'buildings': random.randint(100, 500),
                        'roads_km': round(random.uniform(20, 80), 1),
                    },
                },
                'quality': {
                    'population_data_source': params.get('population_source', 'WorldPop 2023'),
                    'asset_data_source': params.get('asset_source', 'OSM Buildings'),
                    'uncertainty': round(random.uniform(0.05, 0.2), 4),
                    'confidence': round(random.uniform(0.8, 0.95), 4),
                },
                'timestamp': datetime.utcnow().isoformat() + 'Z',
            }
            
            logger.info(f"Exposure computation completed: {task_id}")
            return result
            
    except Exception as e:
        logger.error(f"Exposure computation failed: {task_id}, error: {str(e)}")
        raise self.retry(exc=e, countdown=30)


# ============================================================================
# Batch Processing Tasks
# ============================================================================

@app.task(bind=True, max_retries=2, default_retry_delay=60)
def process_batch(self, task_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process a batch of images or tasks.
    
    Args:
        task_id: Unique task identifier
        params: Parameters including:
            - task_type: Type of task to run (sar, optical, damage, flood)
            - items: List of items to process
            - parallel: Number of parallel workers
    
    Returns:
        Result dictionary with batch processing results
    """
    import time
    import random
    
    logger.info(f"Processing batch: {task_id}")
    start_time = time.time()
    
    try:
        task_type = params.get('task_type', 'optical')
        items = params.get('items', [])
        parallel = params.get('parallel', 2)
        
        # Process each item
        results = []
        for i, item in enumerate(items):
            try:
                # Dispatch sub-task based on type
                if task_type == 'sar':
                    result = process_sar_image(f"{task_id}-{i}", item)
                elif task_type == 'optical':
                    result = process_optical_image(f"{task_id}-{i}", item)
                elif task_type == 'damage':
                    result = run_damage_detection(f"{task_id}-{i}", item)
                elif task_type == 'flood':
                    result = run_flood_detection(f"{task_id}-{i}", item)
                else:
                    result = compute_indices(f"{task_id}-{i}", item)
                
                results.append({
                    'item_index': i,
                    'status': result.get('status', 'unknown'),
                    'outputs': result.get('outputs', {}),
                })
                
            except Exception as e:
                results.append({
                    'item_index': i,
                    'status': 'failed',
                    'error': str(e),
                })
            
            # Small delay between items
            time.sleep(0.1)
        
        processing_time = time.time() - start_time
        
        result = {
            'task_id': task_id,
            'status': 'completed',
            'params': params,
            'outputs': {
                'results': results,
            },
            'metrics': {
                'processing_time_seconds': round(processing_time, 2),
                'items_processed': len(items),
                'items_succeeded': len([r for r in results if r['status'] == 'completed']),
                'items_failed': len([r for r in results if r['status'] == 'failed']),
            },
            'timestamp': datetime.utcnow().isoformat() + 'Z',
        }
        
        logger.info(f"Batch processing completed: {task_id}")
        return result
        
    except Exception as e:
        logger.error(f"Batch processing failed: {task_id}, error: {str(e)}")
        raise self.retry(exc=e, countdown=60)


# ============================================================================
# Health Check
# ============================================================================

@app.task
def health_check() -> Dict[str, Any]:
    """Health check endpoint for the worker."""
    import platform
    import psutil
    
    # Get system info
    cpu_usage = psutil.cpu_percent(interval=1)
    memory_usage = psutil.virtual_memory().percent
    disk_usage = psutil.disk_usage('/').percent
    
    return {
        'status': 'healthy',
        'worker': 'firstlight-python-worker',
        'version': '1.0.0',
        'queues': ['raster', 'ml', 'processing'],
        'system': {
            'hostname': platform.node(),
            'cpu_usage_percent': cpu_usage,
            'memory_usage_percent': memory_usage,
            'disk_usage_percent': disk_usage,
            'python_version': platform.python_version(),
        },
        'dependencies': {
            'numpy': 'available' if 'numpy' in globals() else 'not available',
            'torch': 'available' if 'torch' in globals() else 'not available',
            'rasterio': 'available' if 'rasterio' in globals() else 'not available',
            'gdal': 'available' if 'osgeo' in globals() else 'not available',
        },
        'timestamp': datetime.utcnow().isoformat() + 'Z',
    }


if __name__ == '__main__':
    app.main()
