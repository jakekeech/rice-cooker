#!/usr/bin/env python3
"""
Health monitoring script for TikTok PII Analyzer
Checks all services and provides detailed status
"""

import requests
import time
import json
import subprocess
import sys
from datetime import datetime
from typing import Dict, List, Any

class HealthMonitor:
    def __init__(self, base_url="http://localhost:8000"):
        self.base_url = base_url
        self.services = {
            "API": f"{base_url}/health",
            "Database": f"{base_url}/jobs",
            "Frontend": "http://localhost:3000",
        }
        
    def check_docker_services(self) -> Dict[str, Any]:
        """Check Docker container status"""
        print("🐳 Checking Docker containers...")
        try:
            result = subprocess.run(
                ["docker-compose", "ps", "--format", "json"],
                capture_output=True,
                text=True,
                cwd="."
            )
            
            if result.returncode == 0:
                containers = []
                for line in result.stdout.strip().split('\n'):
                    if line:
                        try:
                            container = json.loads(line)
                            containers.append({
                                "name": container.get("Name", "Unknown"),
                                "service": container.get("Service", "Unknown"),
                                "state": container.get("State", "Unknown"),
                                "status": container.get("Status", "Unknown"),
                                "health": container.get("Health", "Unknown")
                            })
                        except json.JSONDecodeError:
                            continue
                
                print(f"   Found {len(containers)} containers")
                for container in containers:
                    status_icon = "✅" if container["state"] == "running" else "❌"
                    health_icon = ""
                    if container["health"] == "healthy":
                        health_icon = " (🟢 healthy)"
                    elif container["health"] == "unhealthy":
                        health_icon = " (🔴 unhealthy)"
                    elif container["health"] == "starting":
                        health_icon = " (🟡 starting)"
                    
                    print(f"   {status_icon} {container['service']}: {container['state']}{health_icon}")
                
                return {"status": "success", "containers": containers}
            else:
                return {"status": "error", "message": "Docker Compose not available"}
                
        except FileNotFoundError:
            return {"status": "error", "message": "Docker Compose not found"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def check_service_health(self, service_name: str, url: str, timeout: int = 10) -> Dict[str, Any]:
        """Check individual service health"""
        try:
            start_time = time.time()
            response = requests.get(url, timeout=timeout)
            response_time = (time.time() - start_time) * 1000  # Convert to ms
            
            if response.status_code == 200:
                return {
                    "status": "healthy",
                    "response_time_ms": round(response_time, 2),
                    "status_code": response.status_code
                }
            else:
                return {
                    "status": "unhealthy",
                    "response_time_ms": round(response_time, 2),
                    "status_code": response.status_code,
                    "error": f"HTTP {response.status_code}"
                }
        except requests.exceptions.ConnectionError:
            return {
                "status": "down",
                "error": "Connection refused"
            }
        except requests.exceptions.Timeout:
            return {
                "status": "timeout",
                "error": f"Timeout after {timeout}s"
            }
        except Exception as e:
            return {
                "status": "error",
                "error": str(e)
            }

    def check_api_functionality(self) -> Dict[str, Any]:
        """Test basic API functionality"""
        print("🔧 Testing API functionality...")
        
        # Test text analysis
        try:
            test_payload = {"text": "This is a test message."}
            response = requests.post(
                f"{self.base_url}/analyze/text",
                json=test_payload,
                timeout=30
            )
            
            if response.status_code == 200:
                return {"status": "functional", "message": "Text analysis working"}
            else:
                return {"status": "error", "message": f"Text analysis failed: HTTP {response.status_code}"}
        except Exception as e:
            return {"status": "error", "message": f"API test failed: {str(e)}"}

    def check_database_status(self) -> Dict[str, Any]:
        """Check database connectivity and basic stats"""
        print("🗄️ Checking database status...")
        
        try:
            # Get job statistics
            response = requests.get(f"{self.base_url}/jobs?limit=1", timeout=10)
            if response.status_code == 200:
                data = response.json()
                job_count = data.get("total", 0)
                return {
                    "status": "connected",
                    "job_count": job_count,
                    "message": f"Database connected, {job_count} jobs"
                }
            else:
                return {
                    "status": "error",
                    "message": f"Database check failed: HTTP {response.status_code}"
                }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Database check failed: {str(e)}"
            }

    def get_system_resources(self) -> Dict[str, Any]:
        """Get system resource usage (if available)"""
        try:
            # Try to get Docker stats
            result = subprocess.run(
                ["docker", "stats", "--no-stream", "--format", "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"],
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode == 0:
                lines = result.stdout.strip().split('\n')
                if len(lines) > 1:  # Skip header
                    return {
                        "status": "available",
                        "stats": lines[1:]  # Skip the header line
                    }
            
            return {"status": "unavailable", "message": "Docker stats not available"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def run_health_check(self, verbose: bool = True) -> Dict[str, Any]:
        """Run comprehensive health check"""
        if verbose:
            print("🏥 TikTok PII Analyzer - Health Check")
            print("=" * 50)
            print(f"Timestamp: {datetime.now().isoformat()}")
            print()

        results = {
            "timestamp": datetime.now().isoformat(),
            "overall_status": "unknown",
            "services": {},
            "docker": {},
            "api_test": {},
            "database": {},
            "resources": {}
        }

        # Check Docker containers
        results["docker"] = self.check_docker_services()
        
        # Check individual services
        if verbose:
            print("\n🌐 Checking service endpoints...")
        
        healthy_services = 0
        total_services = len(self.services)
        
        for service_name, url in self.services.items():
            service_result = self.check_service_health(service_name, url)
            results["services"][service_name] = service_result
            
            if service_result["status"] == "healthy":
                healthy_services += 1
                icon = "✅"
            else:
                icon = "❌"
            
            if verbose:
                response_time = service_result.get("response_time_ms", "N/A")
                print(f"   {icon} {service_name}: {service_result['status']} ({response_time}ms)")

        # Test API functionality
        results["api_test"] = self.check_api_functionality()
        
        # Check database
        results["database"] = self.check_database_status()
        
        # Get resource usage
        results["resources"] = self.get_system_resources()
        if verbose and results["resources"]["status"] == "available":
            print("\n📊 Resource Usage:")
            for stat_line in results["resources"]["stats"]:
                print(f"   {stat_line}")

        # Determine overall status
        if healthy_services == total_services and results["api_test"]["status"] == "functional":
            results["overall_status"] = "healthy"
        elif healthy_services > 0:
            results["overall_status"] = "partial"
        else:
            results["overall_status"] = "unhealthy"

        if verbose:
            print(f"\n🎯 Overall Status: {results['overall_status'].upper()}")
            print(f"Services: {healthy_services}/{total_services} healthy")
            
            # Recommendations
            print("\n💡 Recommendations:")
            if results["overall_status"] == "healthy":
                print("   ✅ All systems operational!")
            else:
                print("   - Check failed services above")
                print("   - Restart containers: docker-compose restart")
                print("   - Check logs: docker-compose logs -f")
                print("   - Verify ports are not in use by other applications")

        return results

    def monitor_continuously(self, interval: int = 60):
        """Monitor services continuously"""
        print(f"🔄 Starting continuous monitoring (every {interval}s)")
        print("Press Ctrl+C to stop")
        
        try:
            while True:
                print(f"\n{'='*20} {datetime.now().strftime('%H:%M:%S')} {'='*20}")
                results = self.run_health_check(verbose=False)
                
                # Show summary
                status_icon = {"healthy": "✅", "partial": "⚠️", "unhealthy": "❌"}.get(
                    results["overall_status"], "❓"
                )
                print(f"{status_icon} Overall: {results['overall_status'].upper()}")
                
                for service, result in results["services"].items():
                    icon = "✅" if result["status"] == "healthy" else "❌"
                    response_time = result.get("response_time_ms", "N/A")
                    print(f"   {icon} {service}: {response_time}ms")
                
                time.sleep(interval)
                
        except KeyboardInterrupt:
            print("\n\n👋 Monitoring stopped")

def main():
    """Main function"""
    if len(sys.argv) > 1:
        command = sys.argv[1]
        if command == "--help":
            print("Usage: python health_monitor.py [command] [options]")
            print("\nCommands:")
            print("  check        - Run single health check (default)")
            print("  monitor      - Continuous monitoring")
            print("  --help       - Show this help")
            print("\nOptions:")
            print("  --url URL    - Custom API base URL (default: http://localhost:8000)")
            print("  --interval N - Monitoring interval in seconds (default: 60)")
            return
        elif command == "monitor":
            interval = 60
            base_url = "http://localhost:8000"
            
            # Parse additional options
            for i, arg in enumerate(sys.argv[2:], 2):
                if arg == "--interval" and i + 1 < len(sys.argv):
                    interval = int(sys.argv[i + 1])
                elif arg == "--url" and i + 1 < len(sys.argv):
                    base_url = sys.argv[i + 1]
            
            monitor = HealthMonitor(base_url)
            monitor.monitor_continuously(interval)
            return

    # Default: single health check
    base_url = "http://localhost:8000"
    if "--url" in sys.argv:
        url_index = sys.argv.index("--url")
        if url_index + 1 < len(sys.argv):
            base_url = sys.argv[url_index + 1]

    monitor = HealthMonitor(base_url)
    results = monitor.run_health_check()
    
    # Save results to file
    try:
        with open("health_check.json", "w") as f:
            json.dump(results, f, indent=2)
        print(f"\n💾 Results saved to: health_check.json")
    except Exception as e:
        print(f"⚠️  Could not save results: {e}")

if __name__ == "__main__":
    main()