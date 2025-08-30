# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

# TikTok PII Analyzer API

A containerized API for detecting Personally Identifiable Information (PII) in video and audio content using multiple machine learning models.

## Features

- **Video/Audio Analysis**: Upload video or audio files for PII detection
- **Text Analysis**: Direct text analysis for PII detection
- **Multiple ML Models**: Uses ensemble of 4 AI models:
  - Whisper (OpenAI) for speech-to-text
  - Stanford AIMI deidentifier for PII detection
  - BERT NER for named entity recognition
  - Isotonic DeBERTa AI4Privacy for privacy-focused detection
- **Real-time Processing**: Background job processing with status tracking
- **Containerized**: Easy deployment with Docker
- **Model Caching**: Persistent model storage to avoid re-downloading

## Quick Start

### Prerequisites

- Docker and Docker Compose installed
- At least 8GB RAM (for model loading)
- ~10GB free disk space (for models)

### 1. Clone and Setup

```bash
git clone <repository-url>
cd rice-cooker
```

### 2. Start the API

```bash
# Build and start the container
docker-compose up --build -d

# Check container status
docker ps

# View logs (models loading takes 2-5 minutes on first run)
docker logs rice-cooker-api-1 -f
```

### 3. Verify API is Running

```bash
# Test health endpoint
curl http://localhost:8000/health

# Or use the test script
python simple_test.py
```

## API Endpoints

### Base URL: `http://localhost:8000`

### Health Check
```bash
GET /health
```

### Root Information
```bash
GET /
```

### Text Analysis
```bash
POST /analyze/text
Content-Type: application/json

{
  "text": "Please call me at 91234567 for more information."
}
```

### Video/Audio Upload
```bash
POST /analyze/video
Content-Type: multipart/form-data

file: <video/audio file>
```

### Job Status
```bash
GET /jobs/{job_id}
```

### List All Jobs
```bash
GET /jobs
```

### Delete Job
```bash
DELETE /jobs/{job_id}
```

## Usage Examples

### 1. Text Analysis

```python
import requests

response = requests.post(
    "http://localhost:8000/analyze/text",
    json={"text": "Hi John Smith, call me at 91234567"}
)
print(response.json())
```

### 2. File Upload and Analysis

```python
import requests
import time

# Upload file
with open("video.mp4", "rb") as f:
    response = requests.post(
        "http://localhost:8000/analyze/video",
        files={"file": ("video.mp4", f, "video/mp4")}
    )

job_id = response.json()["job_id"]

# Poll for results
while True:
    result = requests.get(f"http://localhost:8000/jobs/{job_id}")
    status = result.json()["status"]
    
    if status == "completed":
        print("Analysis complete!")
        print(result.json())
        break
    elif status == "failed":
        print("Analysis failed!")
        break
    else:
        print(f"Status: {status}")
        time.sleep(3)
```

### 3. Using Test Scripts

```bash
# Test basic API functionality
python simple_test.py

# Test with files from test_data folder
python test_with_files.py

# Test specific file
python test_with_files.py --file test_data_1.m4a

# Save results to JSON files
python test_with_files.py --save
```

## Supported File Formats

### Video
- MP4, AVI, MOV, MKV
- Any format supported by FFmpeg

### Audio
- WAV, MP3, M4A, FLAC
- Opus audio files (Ogg containers)

## Configuration

### Environment Variables

Set these in a `.env` file or Docker environment:

```bash
# Model cache directories (optional)
HF_HOME=/app/models/huggingface
TRANSFORMERS_CACHE=/app/models/huggingface
WHISPER_CACHE=/app/models/whisper
```

### Docker Compose Configuration

```yaml
# docker-compose.yml
services:
  api:
    build: .
    ports:
      - "8000:8000"
    volumes:
      - models_cache:/app/models  # Persistent model storage
    environment:
      - HF_HOME=/app/models/huggingface
    restart: unless-stopped
```

## Troubleshooting

### Container Won't Start

```bash
# Check container status
docker ps -a

# View container logs
docker logs rice-cooker-api-1

# Restart container
docker-compose restart
```

### Models Not Loading

```bash
# Check available disk space (need ~10GB)
df -h

# Check memory usage (need ~8GB RAM)
docker stats

# Clear model cache if corrupted
docker-compose down
docker volume rm rice-cooker_models_cache
docker-compose up --build
```

### API Connection Issues

```bash
# Test if API is responding
curl http://localhost:8000/health

# Check if port 8000 is available
netstat -tulpn | grep 8000

# Test with different port
docker-compose down
# Edit docker-compose.yml to use different port
docker-compose up
```

### File Upload Errors

```bash
# Check file format is supported
file your_video.mp4

# Test with simple audio file
python test_with_files.py --file test.wav

# Check file size (API has upload limits)
ls -lh your_file.mp4
```

## Development

### Local Development (without Docker)

```bash
# Install dependencies
pip install -r requirements.txt

# Start API locally
python api.py

# Run tests
python simple_test.py --url http://localhost:8000
```

### Adding New Models

1. Edit `video_pii_analyzer.py`
2. Add model to the `models` dictionary
3. Rebuild container: `docker-compose up --build`

## Performance Notes

- **First startup**: 2-5 minutes (downloading models)
- **Subsequent startups**: 30-60 seconds (loading cached models)
- **Processing time**: ~30 seconds per minute of audio
- **Memory usage**: ~6-8GB RAM with all models loaded
- **Storage**: ~10GB for model cache

## API Response Format

### Text Analysis Response
```json
{
  "pii_detected": [
    {
      "type": "PHONE_NUMBER",
      "text": "91234567",
      "confidence": 0.90,
      "start": 17,
      "end": 25,
      "model": "regex_phone"
    }
  ],
  "summary": {
    "total_pii_items": 1,
    "has_privacy_concerns": true,
    "pii_types": {
      "PHONE_NUMBER": 1
    }
  }
}
```

### Video Analysis Response
```json
{
  "job_id": "abc-123-def",
  "status": "completed",
  "transcript": "Please call me at nine one two three four five six seven",
  "pii_detected": [...],
  "pii_segments": [
    {
      "timestamp": "0:05 -> 0:10",
      "text": "call me at nine one two three four five six seven",
      "pii": [...]
    }
  ],
  "summary": {
    "total_pii_items": 1,
    "segments_with_pii": 1,
    "has_privacy_concerns": true
  },
  "created_at": "2025-08-30T13:45:00",
  "completed_at": "2025-08-30T13:45:30"
}
```

## License

This project is licensed under the MIT License.

## Support

For issues and questions:
1. Check the troubleshooting section above
2. View container logs: `docker logs rice-cooker-api-1`
3. Test with provided scripts: `python simple_test.py`
4. Create an issue in the repository
