import { Ionicons } from "@expo/vector-icons";
import { ResizeMode, Video } from "expo-av";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const API_BASE_URL = "http://localhost:8000";

interface PIIItem {
  type: string;
  text: string;
  confidence: number;
  start: number;
  end: number;
  model: string;
}

interface PIISegment {
  timestamp: string;
  text: string;
  pii: PIIItem[];
}

interface JobResult {
  job_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  transcript?: string;
  pii_detected?: PIIItem[];
  pii_segments?: PIISegment[];
  summary?: {
    total_pii_items: number;
    segments_with_pii: number;
    has_privacy_concerns: boolean;
    pii_types: Record<string, number>;
  };
  created_at?: string;
  completed_at?: string;
  error?: string;
}

export default function AnalyseScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { jobId, videoUri } = useLocalSearchParams<{
    jobId: string;
    videoUri: string;
  }>();

  const [jobResult, setJobResult] = useState<JobResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const videoRef = useRef<Video>(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: "Analysis Results",
      headerBackTitle: "Back",
      headerBackTitleVisible: true,
    });
  }, [navigation]);

  const fetchJobStatus = useCallback(async () => {
    if (!jobId) return;

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/jobs/${jobId}`);
      const data = await response.json();
      console.log(data);

      if (!response.ok) {
        throw new Error(data?.detail || "Failed to fetch job status");
      }

      setJobResult(data);

      // Continue polling if still processing
      if (data.status === "pending" || data.status === "processing") {
        timeoutRef.current = setTimeout(fetchJobStatus, 300000); // Poll every 5 minutes
      }
    } catch (error: any) {
      console.error("Error fetching job status:", error);
      Alert.alert("Error", error.message || "Failed to fetch analysis results");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (jobId) {
      fetchJobStatus();
    } else {
      setLoading(false);
      Alert.alert("Error", "No job ID provided");
    }

    // Cleanup function to clear timeout when component unmounts
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [jobId, fetchJobStatus]);

  const handleGoBack = () => {
    router.back();
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchJobStatus();
  };

  const formatTimestamp = (timestamp: string) => {
    // Convert "0:05 -> 0:10" format to more readable format
    return timestamp.replace(" -> ", " to ");
  };

  const parseTimestampToSeconds = (timestamp: string) => {
    // Parse "0:05 -> 0:10" format and return start time in seconds
    const startTime = timestamp.split(" -> ")[0];
    const [minutes, seconds] = startTime.split(":").map(Number);
    return minutes * 60 + seconds;
  };

  const handleTimestampClick = async (timestamp: string) => {
    if (!videoRef.current) return;

    try {
      const seconds = parseTimestampToSeconds(timestamp);
      await videoRef.current.setPositionAsync(seconds * 1000); // Convert to milliseconds
      await videoRef.current.playAsync();
    } catch (error) {
      console.error("Error seeking video:", error);
    }
  };

  const getPIITypeColor = (type: string) => {
    const colors: Record<string, string> = {
      PHONE_NUMBER: "#EF4444",
      EMAIL: "#F59E0B",
      PERSON: "#8B5CF6",
      LOCATION: "#10B981",
      ORGANIZATION: "#3B82F6",
      DATE_TIME: "#F97316",
      ID_NUMBER: "#EC4899",
    };
    return colors[type] || "#6B7280";
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />

        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#001F54" />
          <Text style={styles.loadingText}>Analyzing video...</Text>
          <Text style={styles.loadingSubtext}>This may take a few minutes</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!jobResult) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />

        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
          <Text style={styles.errorText}>Failed to load analysis results</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchJobStatus}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Video Player */}
        {videoUri && (
          <View style={styles.videoContainer}>
            <Video
              ref={videoRef}
              source={{ uri: videoUri }}
              style={styles.video}
              resizeMode={ResizeMode.CONTAIN}
              useNativeControls
              shouldPlay={false}
            />
          </View>
        )}

        {jobResult.status === "completed" && jobResult.summary && (
          <>
            {/* Summary */}
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Analysis Summary</Text>
              <View style={styles.summaryRow}>
                <Ionicons
                  name={
                    jobResult.summary.has_privacy_concerns
                      ? "warning"
                      : "checkmark-circle"
                  }
                  size={20}
                  color={
                    jobResult.summary.has_privacy_concerns
                      ? "#EF4444"
                      : "#10B981"
                  }
                />
                <Text style={styles.summaryText}>
                  {jobResult.summary.has_privacy_concerns
                    ? `${jobResult.summary.total_pii_items} privacy concern(s) detected`
                    : "No privacy concerns detected"}
                </Text>
              </View>

              {jobResult.summary.has_privacy_concerns && (
                <View style={styles.piiTypes}>
                  {Object.entries(jobResult.summary.pii_types).map(
                    ([type, count]) => (
                      <View
                        key={type}
                        style={[
                          styles.piiTypeChip,
                          { backgroundColor: getPIITypeColor(type) + "20" },
                        ]}
                      >
                        <Text
                          style={[
                            styles.piiTypeText,
                            { color: getPIITypeColor(type) },
                          ]}
                        >
                          {type.replace("_", " ")}: {count}
                        </Text>
                      </View>
                    )
                  )}
                </View>
              )}
            </View>

            {/* PII Segments with Timestamps */}
            {jobResult.pii_segments && jobResult.pii_segments.length > 0 && (
              <View style={styles.segmentsCard}>
                <Text style={styles.segmentsTitle}>
                  Privacy Issues by Timestamp
                </Text>
                {jobResult.pii_segments.map((segment, index) => (
                  <View key={index} style={styles.segmentItem}>
                    <TouchableOpacity
                      style={styles.timestampContainer}
                      onPress={() => handleTimestampClick(segment.timestamp)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="time-outline" size={16} color="#666" />
                      <Text style={styles.timestampText}>
                        {formatTimestamp(segment.timestamp)}
                      </Text>
                      <Ionicons
                        name="play-circle-outline"
                        size={16}
                        color="#001F54"
                      />
                    </TouchableOpacity>

                    <Text style={styles.segmentText}>{segment.text}</Text>

                    {segment.pii.map((pii, piiIndex) => (
                      <View key={piiIndex} style={styles.piiItem}>
                        <View
                          style={[
                            styles.piiTypeBadge,
                            { backgroundColor: getPIITypeColor(pii.type) },
                          ]}
                        >
                          <Text style={styles.piiTypeBadgeText}>
                            {pii.type.replace("_", " ")}
                          </Text>
                        </View>
                        <Text style={styles.piiText}>{pii.text}</Text>
                        <Text style={styles.confidenceText}>
                          {(pii.confidence * 100).toFixed(0)}% confidence
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            )}

            {/* Full Transcript */}
            {jobResult.transcript && (
              <View style={styles.transcriptCard}>
                <Text style={styles.transcriptTitle}>Full Transcript</Text>
                <Text style={styles.transcriptText}>
                  {jobResult.transcript}
                </Text>
              </View>
            )}
          </>
        )}

        {jobResult.status === "failed" && (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
            <Text style={styles.errorText}>Analysis Failed</Text>
            <Text style={styles.errorSubtext}>
              {jobResult.error || "An error occurred during analysis"}
            </Text>
          </View>
        )}

        {(jobResult.status === "pending" ||
          jobResult.status === "processing") && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#001F54" />
            <Text style={styles.loadingText}>
              {jobResult.status === "pending"
                ? "Queued for processing..."
                : "Processing video..."}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    backgroundColor: "#ffffff",
  },
  backButton: {
    padding: 8,
    borderRadius: 8,
  },
  refreshButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    flex: 1,
    textAlign: "center",
  },
  headerRight: {
    width: 40,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  videoContainer: {
    marginBottom: 16,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  video: {
    width: "100%",
    height: 200,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginTop: 16,
  },
  loadingSubtext: {
    fontSize: 14,
    color: "#666",
    marginTop: 8,
    textAlign: "center",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  errorText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#EF4444",
    marginTop: 16,
    textAlign: "center",
  },
  errorSubtext: {
    fontSize: 14,
    color: "#666",
    marginTop: 8,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: "#001F54",
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  statusContainer: {
    alignItems: "center",
    marginBottom: 16,
  },
  statusBadge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  statusText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  summaryCard: {
    backgroundColor: "#f8f9fa",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  summaryText: {
    fontSize: 16,
    color: "#333",
  },
  piiTypes: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  piiTypeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  piiTypeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  segmentsCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  segmentsTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 16,
  },
  segmentItem: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  timestampContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#f8f9fa",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  timestampText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#001F54",
  },
  segmentText: {
    fontSize: 16,
    color: "#333",
    marginBottom: 12,
    lineHeight: 22,
  },
  piiItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
    flexWrap: "wrap",
  },
  piiTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  piiTypeBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  piiText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  confidenceText: {
    fontSize: 12,
    color: "#666",
  },
  transcriptCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  transcriptTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
  },
  transcriptText: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
  },
});
