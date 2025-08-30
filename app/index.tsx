// app/index.tsx
import { Ionicons } from "@expo/vector-icons";
import { setAudioModeAsync } from "expo-audio";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useNavigation, useRouter, type Href } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const API_BASE_URL = "http://localhost:8000"; // ← change to your backend host/IP

export default function PrivacyFilterUpload() {
  const router = useRouter();
  const navigation = useNavigation();

  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Keep default header/back button; just set the title
  useLayoutEffect(() => {
    navigation.setOptions({ title: "" });
  }, [navigation]);

  // Enable audio playback even with iOS mute switch on
  useEffect(() => {
    (async () => {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true, // iOS: allow playback in silent mode
        });
      } catch {}
    })();
  }, []);

  // Build/refresh player when URI changes
  const player = useVideoPlayer(
    useMemo(() => pickedUri ?? null, [pickedUri]),
    (p) => {
      // init settings whenever player (re)loads this source
      p.muted = false;
      p.volume = 1.0;
      p.loop = false;
      // p.play(); // keep paused for preview; uncomment to auto-play
    }
  );

  const launchPicker = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Media library permission is needed.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      quality: 1,
      base64: false,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      setPickedUri(result.assets[0].uri);
    }
  };

  // Only open gallery if nothing selected yet
  const pickVideo = async () => {
    if (pickedUri) return;
    await launchPicker();
  };

  const changeVideo = async () => {
    await launchPicker();
  };

  const removeVideo = () => {
    setPickedUri(null);
  };

  // Ensure we can upload: convert content:// / ph:// to a file:// temp if needed
  const ensureCacheFile = async (uri: string): Promise<string> => {
    if (uri.startsWith("file://")) return uri;

    const ext = uri.split("?")[0].split(".").pop()?.toLowerCase() || "mp4";
    const dest = `${FileSystem.cacheDirectory}pf_temp_${Date.now()}.${ext}`;
    try {
      await FileSystem.copyAsync({ from: uri, to: dest });
      return dest;
    } catch {
      const dl = await FileSystem.downloadAsync(uri, dest);
      if (dl.status !== 200)
        throw new Error("Failed to prepare video for upload");
      return dl.uri;
    }
  };

  const uploadAndGo = async () => {
    if (!pickedUri) {
      Alert.alert("No video selected", "Choose a video first.");
      return;
    }
    setBusy(true);
    try {
      let fileUri = pickedUri;
      if (!pickedUri.startsWith("file://")) {
        fileUri = await ensureCacheFile(pickedUri);
      }

      const name = fileUri.split("/").pop() || `video_${Date.now()}.mp4`;
      const lower = name.toLowerCase();
      const type = lower.endsWith(".mov")
        ? "video/quicktime"
        : lower.endsWith(".mkv")
        ? "video/x-matroska"
        : "video/mp4";

      const form = new FormData();
      form.append("file", { uri: fileUri, name, type } as any);

      const res = await fetch(`${API_BASE_URL}/analyze/video`, {
        method: "POST",
        body: form,
        // Don’t set Content-Type; RN sets correct multipart boundary
        headers: Platform.OS === "web" ? {} : undefined,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.detail || "Upload failed");

      const jobId: string | undefined = json?.job_id;
      if (!jobId) throw new Error("Missing job_id from API");

      // Navigate to /analyse with jobId and videoUri
      router.push({
        pathname: "/analyse",
        params: { jobId, videoUri: fileUri },
      } as unknown as Href);
    } catch (e: any) {
      console.error(e);
      Alert.alert("Upload Failed", e?.message || "Could not upload video.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.container}>
        {/* Upload card */}
        <View style={styles.uploadCard}>
          <View style={styles.cardHeader}>
            <Ionicons name="videocam-outline" size={28} color="#111827" />
            <Text style={styles.cardHeaderText}>Tap to upload video</Text>
          </View>

          <TouchableOpacity
            style={[styles.pickBox, pickedUri && styles.pickBoxDisabled]}
            onPress={pickVideo}
            activeOpacity={pickedUri ? 1 : 0.85}
          >
            {pickedUri ? (
              <>
                <VideoView
                  player={player}
                  style={styles.preview}
                  nativeControls
                  allowsFullscreen
                  allowsPictureInPicture
                  // Expo Video uses contentFit instead of resizeMode
                  contentFit="contain"
                />
                <Text style={styles.subtleText}>Preview selected video</Text>
              </>
            ) : (
              <View style={styles.emptyBox}>
                <Ionicons
                  name="cloud-upload-outline"
                  size={42}
                  color="#6B7280"
                />
                <Text style={styles.placeholderBig}>Tap to upload video</Text>
              </View>
            )}
          </TouchableOpacity>

          <View style={styles.rowButtons}>
            <TouchableOpacity
              onPress={changeVideo}
              activeOpacity={0.9}
              disabled={busy}
              style={[styles.secondaryBtn]}
            >
              <Ionicons
                name="swap-horizontal-outline"
                size={18}
                color="#0f172a"
              />
              <Text style={styles.secondaryBtnText}>Change video</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={removeVideo}
              activeOpacity={0.9}
              disabled={busy || !pickedUri}
              style={[
                styles.secondaryBtn,
                styles.removeBtn,
                (!pickedUri || busy) && { opacity: 0.6 },
              ]}
            >
              <Ionicons name="trash-outline" size={18} color="#991B1B" />
              <Text style={[styles.secondaryBtnText, { color: "#991B1B" }]}>
                Remove video
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Upload button with shadow on container */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            onPress={uploadAndGo}
            activeOpacity={0.9}
            disabled={busy}
            style={{ width: "100%" }}
          >
            <LinearGradient
              colors={["#ADD8E6", "#001F54"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.button, busy && { opacity: 0.7 }]}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Upload</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* Instructions below button */}
        <Text style={styles.instructions}>
          This app analyses uploaded videos and flags any potential sensitive
          information (PII) that may be exposed.{"\n\n"}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  container: {
    flex: 1,
    padding: 16,
    gap: 16,
    alignItems: "center",
  },
  uploadCard: {
    width: "100%",
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 12,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
    gap: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    justifyContent: "center",
  },
  cardHeaderText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
  },
  pickBox: {
    width: "100%",
    height: 220,
    borderWidth: 2,
    borderColor: "#9CA3AF",
    borderStyle: "dashed",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    backgroundColor: "#F9FAFB",
  },
  pickBoxDisabled: {},
  emptyBox: { alignItems: "center", gap: 10 },
  placeholderBig: { fontSize: 18, fontWeight: "700", color: "#6B7280" },
  subtleText: { marginTop: 8, color: "#374151" },

  preview: {
    width: "100%",
    height: 180,
    borderRadius: 8,
    backgroundColor: "#000",
  },

  rowButtons: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  secondaryBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: "700", color: "#0f172a" },
  removeBtn: { backgroundColor: "#FEE2E2", borderColor: "#FECACA" },

  // Upload button container shadow
  buttonContainer: {
    width: "100%",
    borderRadius: 14,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  button: {
    width: "100%",
    height: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.3,
  },

  instructions: {
    marginTop: 12,
    textAlign: "center",
    fontSize: 12,
    fontStyle: "italic",
    lineHeight: 20,
    color: "#374151",
    paddingHorizontal: 11,
  },
});
