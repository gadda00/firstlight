#!/bin/bash
set -e

echo "Starting FirstLight Python Worker..."
echo "Environment:"
echo "  REDIS_URL: $REDIS_URL"
echo "  DATABASE_URL: $DATABASE_URL"
echo "  PYTHONPATH: $PYTHONPATH"

# Set Python path
EXPORT PYTHONPATH=/app/python:$PYTHONPATH

# Start Celery worker
cd /app/python

echo "Starting Celery worker..."
exec celery -A tasks worker \
    --loglevel=info \
    --concurrency=4 \
    --max-tasks-per-child=100 \
    --max-memory-per-child=500000 \
    --queues=raster,ml,processing \
    --host=0.0.0.0 \
    --port=5555
