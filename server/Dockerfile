# Backend API Dockerfile
FROM python:3.11-slim

# Install system dependencies for audio processing
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Create models directory for volume mounting
RUN mkdir -p /app/models

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY api.py .
COPY video_pii_analyzer.py .
COPY health_monitor.py .

# Set environment variables for model caching
ENV HF_HOME=/app/models/huggingface
ENV TRANSFORMERS_CACHE=/app/models/huggingface
ENV WHISPER_CACHE=/app/models/whisper

# Create cache directories
RUN mkdir -p $HF_HOME $TRANSFORMERS_CACHE $WHISPER_CACHE

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD python health_monitor.py --url http://localhost:8000 || exit 1

# Run the application
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]