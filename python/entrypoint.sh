#!/bin/bash
# FirstLight Python worker entrypoint.
#
# Round 4 fixes: `EXPORT` (not a builtin — with set -e the original script
# died on that line), bogus `--host/--port` celery flags, and a healthcheck
# against a :5555 server that nothing ever started. The worker now boots
# for real and is probed with `celery inspect ping`.
set -e

echo "Starting FirstLight Python Worker..."
echo "  REDIS_URL: $REDIS_URL"
echo "  DATABASE_URL: $DATABASE_URL (credentials never logged)"

# Make tasks.py / secure_download.py importable.
export PYTHONPATH="/app/python${PYTHONPATH:+:$PYTHONPATH}"

cd /app/python

echo "Starting Celery worker (queues: raster,ml,processing)..."
exec celery -A tasks worker \
    --loglevel=info \
    --concurrency="${CELERY_CONCURRENCY:-4}" \
    --max-tasks-per-child=100 \
    --max-memory-per-child=500000 \
    --queues=raster,ml,processing
