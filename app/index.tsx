// File: app/privacy-filter/UploadVideoTemp.js
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Video } from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import * as FileSystem from 'expo-file-system';

export default function UploadVideoTemp() {
  const [pickedUri, setPickedUri] = useState(null);   // original library URI
  const [tempUri, setTempUri] = useState(null);       // cached local URI
  const [busy, setBusy] = useState(false);
  const playerRef = useRef(null);

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
      setTempUri(null);
    }
  };

  // Copy to cache as our “temporary store”
  const saveToTemp = async () => {
    if (!pickedUri) {
      Alert.alert('No video selected', 'Tap the box to choose a video first.');
      return;
    }
    try {
      setBusy(true);

      // Optional: size guard
      const info = await FileSystem.getInfoAsync(pickedUri);
      if (info.exists && info.size && info.size > 300 * 1024 * 1024) { // 300 MB
        Alert.alert('File too large', 'Please choose a smaller video.');
        setBusy(false);
        return;
      }

      const ext = pickedUri.split('.').pop()?.toLowerCase() || 'mp4';
      const dest = `${FileSystem.cacheDirectory}temp_video_${Date.now()}.${ext}`;

      // Some gallery URIs are not directly copyable; if that happens,
      // use FileSystem.downloadAsync as a fallback.
      try {
        await FileSystem.copyAsync({ from: pickedUri, to: dest });
      } catch {
        const dl = await FileSystem.downloadAsync(pickedUri, dest);
        if (dl.status !== 200) throw new Error('Download to cache failed');
      }

      setTempUri(dest);
      Alert.alert('Saved', 'Video stored temporarily on device.');
    } catch (e) {
      console.error(e);
      Alert.alert('Failed', 'Could not store the video temporarily.');
    } finally {
      setBusy(false);
    }
  };

  const clearTemp = async () => {
    try {
      if (tempUri) {
        const info = await FileSystem.getInfoAsync(tempUri);
        if (info.exists) {
          await FileSystem.deleteAsync(tempUri, { idempotent: true });
        }
      }
      setTempUri(null);
      setPickedUri(null);
      // Stop playback if active
      if (playerRef.current) {
        await playerRef.current.stopAsync?.().catch(() => {});
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Clean up temp file when screen unmounts (safety)
  useEffect(() => {
    return () => {
      if (tempUri) {
        FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
      }
    };
  }, [tempUri]);

  const displayUri = tempUri || pickedUri; // preview whatever we have

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      {/* Default header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Privacy Filter</Text>
      </View>

      {/* Upload Video section */}
      <View style={styles.container}>
        <Text style={styles.label}>Upload Video</Text>

        <TouchableOpacity style={styles.pickBox} onPress={pickVideo} activeOpacity={0.85}>
          {displayUri ? (
            <>
              <Video
                ref={playerRef}
                source={{ uri: displayUri }}
                style={styles.preview}
                resizeMode="contain"
                useNativeControls
              />
              <Text style={styles.changeText}>
                {tempUri ? 'Saved to temp • Tap to replace' : 'Picked • Tap to change'}
              </Text>
            </>
          ) : (
            <Text style={styles.placeholderText}>Tap to choose a video</Text>
          )}
        </TouchableOpacity>

        {/* Gradient action button */}
        <TouchableOpacity onPress={saveToTemp} activeOpacity={0.85} disabled={busy} style={{ width: '100%' }}>
          <LinearGradient
            colors={['#ADD8E6', '#001F54']} // light blue → dark navy
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.btn, busy && { opacity: 0.7 }]}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.btnText}>{tempUri ? 'Re-save to Temp' : 'Save to Temp'}</Text>
            )}
          </LinearGradient>
        </TouchableOpacity>

        {tempUri ? (
          <View style={styles.result}>
            <Text style={styles.resultLabel}>Temporary file path:</Text>
            <Text selectable style={styles.resultUrl}>{tempUri}</Text>

            <TouchableOpacity onPress={clearTemp} style={styles.clearBtn} activeOpacity={0.85}>
              <Text style={styles.clearText}>Clear temp file</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#111827', textAlign: 'center' },
  container: { flex: 1, padding: 16, gap: 16 },
  label: { fontSize: 16, fontWeight: '600', color: '#111827' },
  pickBox: {
    width: '100%', height: 220,
    borderWidth: 2, borderColor: '#9CA3AF', borderStyle: 'dashed',
    borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    padding: 8, backgroundColor: '#F9FAFB',
  },
  placeholderText: { color: '#6B7280' },
  changeText: { marginTop: 8, color: '#374151' },
  preview: { width: '100%', height: 180, borderRadius: 8, backgroundColor: '#000' },
  btn: {
    width: '100%', height: 52, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  result: { marginTop: 8, backgroundColor: '#F3F4F6', borderRadius: 8, padding: 12, gap: 8 },
  resultLabel: { fontWeight: '600', color: '#111827' },
  resultUrl: { color: '#1F2937' },
  clearBtn: {
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
  },
  clearText: { color: '#991B1B', fontWeight: '600' },
});
