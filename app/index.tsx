// app/index.tsx
import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
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
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Video, ResizeMode } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useNavigation, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const API_BASE_URL = 'http://localhost:8000'; // ← change to your backend host/IP

export default function PrivacyFilterUpload() {
  const router = useRouter();
  const navigation = useNavigation();
  const playerRef = useRef<Video>(null);

  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Keep default header/back button; just set the title
  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Privacy Filter' });
  }, [navigation]);

  const pickVideo = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Media library permission is needed.');
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

  // Make sure we have a file:// path (copy/download to cache only if required)
  const ensureCacheFile = async (uri: string): Promise<string> => {
    if (uri.startsWith('file://')) return uri;

    const ext = uri.split('?')[0].split('.').pop()?.toLowerCase() || 'mp4';
    const dest = `${FileSystem.cacheDirectory}pf_temp_${Date.now()}.${ext}`;

    try {
      await FileSystem.copyAsync({ from: uri, to: dest });
      return dest;
    } catch {
      const dl = await FileSystem.downloadAsync(uri, dest);
      if (dl.status !== 200) throw new Error('Failed to prepare video for upload');
      return dl.uri;
    }
  };

  const uploadAndGo = async () => {
    if (!pickedUri) {
      Alert.alert('No video selected', 'Choose a video first.');
      return;
    }
    setBusy(true);

    try {
      let fileUri = pickedUri;
      if (!pickedUri.startsWith('file://')) {
        fileUri = await ensureCacheFile(pickedUri);
      }

      const name = fileUri.split('/').pop() || `video_${Date.now()}.mp4`;
      const lower = name.toLowerCase();
      const type =
        lower.endsWith('.mov') ? 'video/quicktime' :
        lower.endsWith('.mkv') ? 'video/x-matroska' :
        'video/mp4';

      const form = new FormData();
      form.append('file', { uri: fileUri, name, type } as any);

      const res = await fetch(`${API_BASE_URL}/analyze/video`, {
        method: 'POST',
        body: form,
        // Don’t set Content-Type; RN sets correct multipart boundary
        headers: Platform.OS === 'web' ? {} : undefined,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.detail || 'Upload failed');

      const jobId: string | undefined = json?.job_id;
      if (!jobId) throw new Error('Missing job_id from API');

      // Navigate to /analyse with jobId
      router.push({ pathname: '/analyse', params: { jobId } } as unknown as Href);
    } catch (e: any) {
      console.error(e);
      Alert.alert('Upload Failed', e?.message || 'Could not upload video.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.container}>

        {/* NEW: Card box with icon + label + upload area */}
        <View style={styles.uploadCard}>
          <View style={styles.cardHeader}>
            <Ionicons name="videocam-outline" size={20} color="#111827" />
            <Text style={styles.cardHeaderText}>Tap to upload video</Text>
          </View>

          <TouchableOpacity style={styles.pickBox} onPress={pickVideo} activeOpacity={0.85}>
            {pickedUri ? (
              <>
                <Video
                  ref={playerRef}
                  source={{ uri: pickedUri }}
                  style={styles.preview}
                  resizeMode={ResizeMode.CONTAIN}
                  useNativeControls
                />
                <Text style={styles.subtleText}>Picked • Tap to change</Text>
              </>
            ) : (
              <View style={styles.emptyBox}>
                <Ionicons name="cloud-upload-outline" size={24} color="#6B7280" />
                <Text style={styles.placeholderText}>Tap to upload video</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={uploadAndGo} activeOpacity={0.85} disabled={busy} style={{ width: '100%' }}>
          <LinearGradient
            colors={['#ADD8E6', '#001F54']} // light blue → dark navy
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: {
    flex: 1,
    padding: 16,
    gap: 16,
    height: '100%',
    alignItems: 'center',
  },

  // --- Upload card wrapper ---
  uploadCard: {
    width: '100%',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 12,
    // subtle shadow
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  cardHeaderText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },

  // --- Upload area ---
  pickBox: {
    width: '100%',
    height: 220,
    borderWidth: 2,
    borderColor: '#9CA3AF',
    borderStyle: 'dashed',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    backgroundColor: '#F9FAFB',
  },
  emptyBox: {
    alignItems: 'center',
    gap: 8,
  },
  placeholderText: { color: '#6B7280' },
  subtleText: { marginTop: 8, color: '#374151' },
  preview: { width: '100%', height: 180, borderRadius: 8, backgroundColor: '#000' },

  // --- Upload button ---
  button: {
    width: '100%',
    height: 52,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
