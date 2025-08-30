#!/usr/bin/env python3
"""
Test script that uploads files from test_data folder to the API
and retrieves the analysis results
"""

import requests
import json
import time
import os
from pathlib import Path
import sys

class FileUploadTester:
    def __init__(self, base_url="http://localhost:8000"):
        self.base_url = base_url
        self.session = requests.Session()
        
    def upload_and_analyze_file(self, file_path):
        """Upload a file and wait for analysis results"""
        file_path = Path(file_path)
        
        if not file_path.exists():
            print(f"ERROR: File not found: {file_path}")
            return None
            
        print(f"\nUploading file: {file_path.name}")
        print(f"File size: {file_path.stat().st_size / 1024:.1f} KB")
        
        try:
            # Upload file - determine MIME type based on extension
            mime_type = 'audio/m4a'
            if file_path.suffix.lower() in ['.mp4', '.mov', '.avi']:
                mime_type = 'video/mp4'
            elif file_path.suffix.lower() in ['.wav']:
                mime_type = 'audio/wav'
            elif file_path.suffix.lower() in ['.m4a']:
                mime_type = 'audio/m4a'
                
            with open(file_path, 'rb') as f:
                files = {
                    'file': (file_path.name, f, mime_type)
                }
                
                print("Uploading...")
                response = self.session.post(
                    f"{self.base_url}/analyze/video",
                    files=files,
                    timeout=60
                )
                
                if response.status_code != 200:
                    print(f"Upload failed: {response.status_code}")
                    print(f"Response: {response.text}")
                    return None
                
                data = response.json()
                job_id = data.get("job_id")
                print(f"Upload successful! Job ID: {job_id}")
                
        except Exception as e:
            print(f"Upload error: {e}")
            return None
            
        # Poll for results
        print("Waiting for analysis to complete...")
        max_attempts = 60  # 3 minutes max
        attempt = 0
        
        while attempt < max_attempts:
            try:
                response = self.session.get(f"{self.base_url}/jobs/{job_id}")
                
                if response.status_code != 200:
                    print(f"Status check failed: {response.status_code}")
                    return None
                    
                data = response.json()
                status = data.get("status")
                
                if status == "completed":
                    return data
                elif status == "failed":
                    error = data.get("error", "Unknown error")
                    print(f"Analysis failed: {error}")
                    return None
                elif status in ["queued", "processing"]:
                    print(f"Status: {status}... (attempt {attempt + 1}/{max_attempts})")
                    time.sleep(3)
                    attempt += 1
                else:
                    print(f"Unknown status: {status}")
                    return None
                    
            except Exception as e:
                print(f"Status check error: {e}")
                return None
        
        print("Analysis timed out")
        return None
    
    def display_results(self, results, filename):
        """Display analysis results in a readable format"""
        if not results:
            return
            
        print(f"\n{'='*60}")
        print(f"ANALYSIS RESULTS FOR: {filename}")
        print(f"{'='*60}")
        
        # Basic info
        print(f"Job ID: {results.get('job_id')}")
        print(f"Status: {results.get('status')}")
        print(f"Created: {results.get('created_at')}")
        print(f"Completed: {results.get('completed_at')}")
        
        # Transcript
        transcript = results.get('transcript', '')
        print(f"\nTRANSCRIPT:")
        print(f"Length: {len(transcript)} characters")
        print(f"Content: {transcript[:200]}{'...' if len(transcript) > 200 else ''}")
        
        # PII Detection
        pii_detected = results.get('pii_detected', [])
        print(f"\nPII DETECTION:")
        print(f"Total PII items found: {len(pii_detected)}")
        
        if pii_detected:
            print("Detected PII:")
            for pii in pii_detected:
                ensemble_info = ""
                if pii.get('ensemble_count', 0) > 1:
                    models = ', '.join(pii.get('ensemble_models', []))
                    ensemble_info = f" [detected by {pii['ensemble_count']} models: {models}]"
                
                print(f"  - {pii['type']}: '{pii['text']}' (confidence: {pii['confidence']:.2f}){ensemble_info}")
        else:
            print("  No PII detected")
        
        # Segments with PII
        pii_segments = results.get('pii_segments', [])
        if pii_segments:
            print(f"\nSEGMENTS WITH PII ({len(pii_segments)}):")
            for segment in pii_segments:
                print(f"  [{segment['timestamp']}] {segment['text']}")
                for pii in segment['pii']:
                    print(f"    -> {pii['type']}: '{pii['text']}' ({pii['confidence']:.2f})")
        
        # Summary
        summary = results.get('summary', {})
        print(f"\nSUMMARY:")
        print(f"  Has privacy concerns: {summary.get('has_privacy_concerns', False)}")
        print(f"  Total PII items: {summary.get('total_pii_items', 0)}")
        print(f"  Segments with PII: {summary.get('segments_with_pii', 0)}")
        
        pii_types = summary.get('pii_types', {})
        if pii_types:
            print(f"  PII types found:")
            for pii_type, count in pii_types.items():
                print(f"    - {pii_type}: {count}")
        
        print(f"{'='*60}")
        
    def save_results_to_file(self, results, filename):
        """Save results to JSON file"""
        if not results:
            return
            
        output_file = f"results_{filename}.json"
        try:
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(results, f, indent=2, ensure_ascii=False)
            print(f"Results saved to: {output_file}")
        except Exception as e:
            print(f"Failed to save results: {e}")

def main():
    """Main function"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Test API with files from test_data folder")
    parser.add_argument("--url", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--file", help="Specific file to test (default: test all files)")
    parser.add_argument("--save", action="store_true", help="Save results to JSON files")
    parser.add_argument("--folder", default="test_data", help="Folder containing test files")
    
    args = parser.parse_args()
    
    tester = FileUploadTester(args.url)
    
    # Check if API is healthy
    try:
        response = requests.get(f"{args.url}/health", timeout=10)
        if response.status_code != 200:
            print(f"API health check failed: {response.status_code}")
            sys.exit(1)
        print(f"API is healthy at: {args.url}")
    except Exception as e:
        print(f"Cannot connect to API: {e}")
        sys.exit(1)
    
    test_folder = Path(args.folder)
    if not test_folder.exists():
        print(f"Test folder not found: {test_folder}")
        sys.exit(1)
    
    if args.file:
        # Test specific file
        file_path = test_folder / args.file
        results = tester.upload_and_analyze_file(file_path)
        if results:
            tester.display_results(results, args.file)
            if args.save:
                tester.save_results_to_file(results, args.file)
    else:
        # Test all files in folder
        audio_files = list(test_folder.glob("*.m4a")) + list(test_folder.glob("*.mp4")) + list(test_folder.glob("*.wav"))
        
        if not audio_files:
            print(f"No audio/video files found in {test_folder}")
            sys.exit(1)
        
        print(f"Found {len(audio_files)} files to test")
        
        successful_tests = 0
        for file_path in sorted(audio_files):
            results = tester.upload_and_analyze_file(file_path)
            if results:
                tester.display_results(results, file_path.name)
                if args.save:
                    tester.save_results_to_file(results, file_path.name)
                successful_tests += 1
            
            # Small delay between files
            time.sleep(2)
        
        print(f"\nSUMMARY: {successful_tests}/{len(audio_files)} files processed successfully")

if __name__ == "__main__":
    main()