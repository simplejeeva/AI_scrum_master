class VoiceAssistant {
  constructor() {
    // WebRTC variables
    this.pc = null;
    this.dc = null;
    this.stream = null;
    this.track = null;

    // State variables
    this.isConnected = false;
    this.isRecording = false;
    this.isAISpeaking = false;
    this.isUserSpeaking = false;

    // Audio processing
    this.audioContext = null;
    this.analyser = null;
    this.microphone = null;
    this.gainNode = null;
    this.speakingThreshold = -45; // Less sensitive threshold
    this.speakingTimeout = null;
    this.ambientNoiseLevel = -60; // Will be calibrated
    this.calibrationSamples = [];
    this.isCalibrating = false;
    this.voiceDebugEnabled = false;

    // Standup State Management
    this.teamData = [];
    this.currentMemberIndex = 0;
    this.currentQuestionStep = 0;
    this.standupCompleted = false;
    this.waitingForResponse = false;
    this.lastUserResponse = "";
    this.questionStates = {
      YESTERDAY: 0,
      TODAY: 1,
      BLOCKERS: 2,
    };

    this.loadPreviousDayData();

    // DOM Elements
    this.startBtn = document.getElementById("startBtn");
    this.stopBtn = document.getElementById("stopBtn");
    this.connectionStatus = document.getElementById("connectionStatus");
    this.conversationArea = document.getElementById("conversationArea");
    this.loadingSpinner = document.getElementById("loadingSpinner");
    this.statusMessage = document.getElementById("statusMessage");
    this.currentMemberDisplay = document.getElementById("currentMemberDisplay");

    // Microphone UI Elements
    this.micButton = document.getElementById("micButton");
    this.micIcon = document.getElementById("micIcon");
    this.recordingAnimation = document.getElementById("recordingAnimation");
    this.pulseRing = document.getElementById("pulseRing");
    this.micStatusText = document.getElementById("micStatusText");
    this.micStatusSubtext = document.getElementById("micStatusSubtext");
    this.aiSpeakingIndicator = document.getElementById("aiSpeakingIndicator");
    this.userSpeakingIndicator = document.getElementById(
      "userSpeakingIndicator"
    );

    this.initializeEventListeners();
  }

  // ===== AUDIO CONTROLS =====
  setMicrophoneVolume(volume) {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(2, volume)); // Clamp between 0 and 2
      console.log(`🎤 Microphone volume set to: ${this.gainNode.gain.value}`);
    }
  }

  setSpeakingThreshold(threshold) {
    this.speakingThreshold = threshold;
    console.log(`🎤 Speaking threshold set to: ${threshold}dB`);
    this.addMessage("system", `🎤 Speaking threshold adjusted to: ${threshold}dB`);
  }

  // Enable/disable voice detection debugging
  enableVoiceDebug(enable = true) {
    this.voiceDebugEnabled = enable;
    console.log(`🎤 Voice detection debugging: ${enable ? "enabled" : "disabled"}`);
    this.addMessage("system", `🎤 Voice debug: ${enable ? "ON" : "OFF"}`);
  }

  // Manual voice detection bypass for testing
  forceVoiceDetection() {
    if (this.waitingForResponse && !this.isAISpeaking) {
      console.log("🎤 Manually triggering voice detection");
      this.onUserStartSpeaking();
      setTimeout(() => {
        if (this.isUserSpeaking) {
          this.onUserStopSpeaking();
        }
      }, 3000);
    }
  }

  // Get current audio levels for UI display
  getCurrentAudioLevel() {
    if (!this.analyser) return 0;
    
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);
    
    const average = dataArray.reduce((a, b) => a + b) / bufferLength;
    return 20 * Math.log10(average / 255);
  }

  // Test audio constraints support
  static async testAudioConstraints() {
    try {
      const testStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      
      const track = testStream.getAudioTracks()[0];
      const capabilities = track.getCapabilities();
      const settings = track.getSettings();
      
      // Clean up test stream
      testStream.getTracks().forEach(track => track.stop());
      
      return {
        supported: true,
        capabilities,
        settings
      };
    } catch (error) {
      return {
        supported: false,
        error: error.message
      };
    }
  }

  // ===== EVENT LISTENERS =====
  initializeEventListeners() {
    this.startBtn.addEventListener("click", () => this.startConversation());
    this.stopBtn.addEventListener("click", () => this.stopConversation());

    // Enhanced mic button click handler
    if (this.micButton) {
      this.micButton.addEventListener("click", () => {
        console.log(" Mic button clicked");
        this.toggleMicrophone();
      });
    }

    window.addEventListener("beforeunload", () => this.cleanup());
    window.addEventListener("pagehide", () => this.cleanup());
  }

  // ===== MAIN CONVERSATION FLOW =====
  async startConversation() {
    try {
      this.showLoading(true);
      this.updateStatus("Connecting...", "info");

      // Define enhanced audio constraints for better voice quality
      const constraints = {
        audio: {
          // Echo Cancellation: Reduces echo in mic input
          echoCancellation: true,
          
          // Noise Suppression: Removes background noise
          noiseSuppression: true,
          
          // Auto Gain Control: Automatically adjusts microphone volume
          autoGainControl: true,
          
          // Additional audio quality settings
          sampleRate: 48000,        // High quality audio sampling
          sampleSize: 16,           // 16-bit audio depth
          channelCount: 1,          // Mono audio (sufficient for voice)
          
          // Latency optimization for real-time conversation
          latency: 0.01,            // 10ms latency target
          
          // Volume and quality constraints
          volume: 1.0,              // Full volume capture
          
          // Advanced noise processing (if supported by browser)
          googEchoCancellation: true,
          googNoiseSuppression: true,
          googAutoGainControl: true,
          googHighpassFilter: true,    // Remove low-frequency noise
          googTypingNoiseDetection: true, // Reduce keyboard noise
          googAudioMirroring: false,      // Disable audio mirroring
        },
      };

      // Use constraints with fallback for better compatibility
      try {
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.track = this.stream.getAudioTracks()[0];
        
        // Log the actual audio settings that were applied
        const settings = this.track.getSettings();
        console.log("🎤 Audio track settings applied:", settings);
        
        // Verify key audio features are enabled
        this.logAudioCapabilities();
        
      } catch (error) {
        console.warn("⚠️ Enhanced audio constraints failed, falling back to basic settings:", error);
        
        // Fallback to basic constraints if enhanced ones fail
        const basicConstraints = {
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        };
        
        this.stream = await navigator.mediaDevices.getUserMedia(basicConstraints);
        this.track = this.stream.getAudioTracks()[0];
        console.log("🎤 Using basic audio constraints as fallback");
      }

      // Setup WebRTC and start
      await this.setupWebRTC();
      this.setupAudioAnalysis();

      this.isConnected = true;
      this.isRecording = true;
      this.updateUI();
      this.updateStatus("Connected successfully!", "success");
      this.updateCurrentMemberUI();
      this.addMessage("system", "🎤 Standup meeting started!");

      // CRITICAL: Start with user speaking (mic unmuted) - NOT AI speaking
      this.startUserSpeaking();
    } catch (error) {
      console.error("Failed to start conversation:", error);
      this.updateStatus("Failed to connect: " + error.message, "error");
    } finally {
      this.showLoading(false);
    }
  }

  // NEW METHOD: Start with user speaking first
  startUserSpeaking() {
    this.isAISpeaking = false;
    this.waitingForResponse = true;
    this.unmuteMicrophone(); // CRITICAL: Unmute for user to speak first
    this.updateMicrophoneUI(false);
    this.updateSpeakingIndicator("user");

    if (this.aiSpeakingIndicator) {
      this.aiSpeakingIndicator.classList.add("hidden");
    }
    if (this.userSpeakingIndicator) {
      this.userSpeakingIndicator.classList.remove("hidden");
    }

    if (this.micStatusText) {
      this.micStatusText.textContent = "Listening...";
    }
    if (this.micStatusSubtext) {
      this.micStatusSubtext.textContent = "Speak now to start the standup";
    }
  }

  // ===== MICROPHONE CONTROL =====
  muteMicrophone() {
    if (this.track && this.track.readyState === "live") {
      this.track.enabled = false;
      console.log("🔇 Microphone MUTED");
      this.updateMicrophoneUI(false);
    }
  }

  unmuteMicrophone() {
    if (this.track && this.track.readyState === "live") {
      this.track.enabled = true;
      console.log("🎤 Microphone UNMUTED");
      this.updateMicrophoneUI(true);
    }
  }

  // NEW: Manual microphone toggle
  toggleMicrophone() {
    if (!this.isConnected) return;

    console.log("🎤 Manual mic toggle clicked");

    if (this.track && this.track.readyState === "live") {
      const isCurrentlyMuted = !this.track.enabled;

      if (isCurrentlyMuted) {
        // Only unmute if AI is not speaking and waiting for response
        if (!this.isAISpeaking && this.waitingForResponse) {
          console.log("🎤 Manually unmuting microphone");
          this.unmuteMicrophone();
          this.onUserStartSpeaking();
        } else {
          console.log(
            "❌ Cannot unmute - AI is speaking or not waiting for response"
          );
          this.updateStatus("Cannot unmute - AI is speaking", "error");
        }
      } else {
        // Mute the microphone
        console.log("🎤 Manually muting microphone");
        this.muteMicrophone();
        this.onUserStopSpeaking();
      }
    }
  }

  // ===== AI SPEAKING CONTROL =====
  startAISpeaking() {
    console.log("🤖 AI started speaking");
    this.isAISpeaking = true;
    this.waitingForResponse = false;

    // CRITICAL: Mute microphone when AI starts speaking
    this.muteMicrophone();
    this.updateSpeakingIndicator("ai");

    // CRITICAL: Update UI immediately
    this.updateMicrophoneUI(false);

    if (this.aiSpeakingIndicator) {
      this.aiSpeakingIndicator.classList.remove("hidden");
    }
    if (this.userSpeakingIndicator) {
      this.userSpeakingIndicator.classList.add("hidden");
    }

    if (this.micStatusText) {
      this.micStatusText.textContent = "AI Speaking...";
    }
    if (this.micStatusSubtext) {
      this.micStatusSubtext.textContent = "Microphone: Muted";
    }
  }

  stopAISpeaking() {
    console.log("🤖 AI stopped speaking");
    this.isAISpeaking = false;

    if (this.aiSpeakingIndicator) {
      this.aiSpeakingIndicator.classList.add("hidden");
    }

    // CRITICAL: Unmute when AI stops speaking and is ready to listen
    this.unmuteMicrophone();
    this.waitingForResponse = true;
    this.updateSpeakingIndicator("user");
    this.updateMicrophoneUI(false);

    if (this.micStatusText) {
      this.micStatusText.textContent = "Listening...";
    }
    if (this.micStatusSubtext) {
      this.micStatusSubtext.textContent = "Speak now or click mic to toggle";
    }
  }

  // ===== USER SPEAKING CONTROL =====
  onUserStartSpeaking() {
    if (this.isAISpeaking) {
      console.log("❌ Cannot start user speaking - AI is speaking");
      return;
    }

    if (!this.waitingForResponse) {
      console.log("❌ Cannot start user speaking - not waiting for response");
      return;
    }

    console.log("👤 User started speaking");
    this.isUserSpeaking = true;
    this.updateSpeakingIndicator("user");

    // CRITICAL: Update UI immediately
    this.updateMicrophoneUI(true);

    if (this.aiSpeakingIndicator) {
      this.aiSpeakingIndicator.classList.add("hidden");
    }
  }

  onUserStopSpeaking() {
    if (!this.isUserSpeaking) return;

    console.log("👤 User stopped speaking");
    this.isUserSpeaking = false;

    if (this.userSpeakingIndicator) {
      this.userSpeakingIndicator.classList.add("hidden");
    }

    // CRITICAL: Update UI immediately
    this.updateMicrophoneUI(false);

    // Process user response - but don't start AI speaking yet, 
    // let the AI transcript processing handle that
    if (this.waitingForResponse && this.lastUserResponse.trim()) {
      console.log("📝 User response received, waiting for AI processing:", this.lastUserResponse);
      // Don't clear lastUserResponse here - let handleAIResponse do it
      // Don't set waitingForResponse to false - let AI response handle the flow
    }
  }

  // ===== AUDIO CAPABILITIES AND ANALYSIS =====
  logAudioCapabilities() {
    const capabilities = this.track.getCapabilities();
    const settings = this.track.getSettings();
    
    console.log("🎵 Audio Capabilities:");
    console.log("  Echo Cancellation:", capabilities.echoCancellation);
    console.log("  Noise Suppression:", capabilities.noiseSuppression);
    console.log("  Auto Gain Control:", capabilities.autoGainControl);
    console.log("  Sample Rate Range:", capabilities.sampleRate);
    console.log("  Channel Count Range:", capabilities.channelCount);
    
    console.log("🎛️ Applied Settings:");
    console.log("  Echo Cancellation:", settings.echoCancellation);
    console.log("  Noise Suppression:", settings.noiseSuppression);
    console.log("  Auto Gain Control:", settings.autoGainControl);
    console.log("  Sample Rate:", settings.sampleRate);
    console.log("  Channel Count:", settings.channelCount);
    
    // Show user-friendly status
    const featuresEnabled = [];
    if (settings.echoCancellation) featuresEnabled.push("Echo Cancellation");
    if (settings.noiseSuppression) featuresEnabled.push("Noise Suppression");
    if (settings.autoGainControl) featuresEnabled.push("Auto Gain Control");
    
    this.addMessage("system", `🎤 Audio features enabled: ${featuresEnabled.join(", ")}`);
  }

  setupAudioAnalysis() {
    if (!this.stream) return;

    try {
      // Create audio context with optimized settings
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 48000,        // Match our constraint
        latencyHint: "interactive" // Optimize for low latency
      });
      
      // Create analyser with optimized settings for voice detection
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;           // Higher resolution for better voice detection
      this.analyser.smoothingTimeConstant = 0.3; // Less smoothing for more responsive detection
      this.analyser.minDecibels = -90;       // Lower threshold for quiet detection
      this.analyser.maxDecibels = -10;       // Upper threshold
      
      // Create audio processing nodes
      this.microphone = this.audioContext.createMediaStreamSource(this.stream);
      
      // Optional: Add a gain node for volume control
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 1.0; // Default volume
      
      // Connect the audio pipeline
      this.microphone.connect(this.gainNode);
      this.gainNode.connect(this.analyser);
      
      console.log("🎵 Audio analysis setup complete with enhanced voice detection");
      this.calibrateAmbientNoise();
      
    } catch (error) {
      console.error("❌ Audio analysis setup failed:", error);
      // Fallback to basic setup
      this.setupBasicAudioAnalysis();
    }
  }

  setupBasicAudioAnalysis() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    
    this.microphone = this.audioContext.createMediaStreamSource(this.stream);
    this.microphone.connect(this.analyser);
    
    console.log("🎵 Basic audio analysis setup complete");
    this.calibrateAmbientNoise();
  }

  // Calibrate ambient noise to improve voice detection
  calibrateAmbientNoise() {
    this.isCalibrating = true;
    this.calibrationSamples = [];
    
    this.addMessage("system", "🎤 Calibrating ambient noise... Please remain quiet for 3 seconds.");
    
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let sampleCount = 0;
    const maxSamples = 60; // 3 seconds at ~20fps
    
    const calibrate = () => {
      if (!this.isConnected || sampleCount >= maxSamples) {
        this.finishCalibration();
        return;
      }
      
      this.analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / bufferLength;
      const db = 20 * Math.log10(average / 255);
      
      this.calibrationSamples.push(db);
      sampleCount++;
      
      requestAnimationFrame(calibrate);
    };
    
    calibrate();
  }
  
  finishCalibration() {
    this.isCalibrating = false;
    
    if (this.calibrationSamples.length > 0) {
      // Calculate average ambient noise level
      const avgNoise = this.calibrationSamples.reduce((a, b) => a + b) / this.calibrationSamples.length;
      
      // Set threshold 10dB above ambient noise
      this.ambientNoiseLevel = avgNoise;
      this.speakingThreshold = Math.max(-50, avgNoise + 12);
      
      console.log(`🎤 Ambient noise level: ${avgNoise.toFixed(1)}dB`);
      console.log(`🎤 Speaking threshold set to: ${this.speakingThreshold.toFixed(1)}dB`);
      
      this.addMessage("system", `🎤 Calibration complete! Ambient: ${avgNoise.toFixed(1)}dB, Threshold: ${this.speakingThreshold.toFixed(1)}dB`);
    }
    
    this.startVoiceDetection();
  }

  // Enhanced voice detection with immediate UI updates
  startVoiceDetection() {
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const frequencyData = new Uint8Array(bufferLength);

    const detectVoice = () => {
      if (!this.isConnected || this.isCalibrating) return;

      // Get both time and frequency domain data for better voice detection
      this.analyser.getByteFrequencyData(dataArray);
      this.analyser.getByteTimeDomainData(frequencyData);
      
      // Calculate average amplitude
      const average = dataArray.reduce((a, b) => a + b) / bufferLength;
      const db = 20 * Math.log10(average / 255);
      
      // Calculate voice characteristics for better detection
      const voiceFrequencyRange = dataArray.slice(10, 85); // Focus on human voice frequencies (300Hz-3400Hz)
      const voiceAverage = voiceFrequencyRange.reduce((a, b) => a + b) / voiceFrequencyRange.length;
      const voiceDb = 20 * Math.log10(voiceAverage / 255);
      
      // Calculate zero-crossing rate for voice detection
      let zeroCrossings = 0;
      for (let i = 1; i < frequencyData.length; i++) {
        if ((frequencyData[i] >= 128) !== (frequencyData[i - 1] >= 128)) {
          zeroCrossings++;
        }
      }
      const zeroCrossingRate = zeroCrossings / frequencyData.length;
      
      // Enhanced voice detection algorithm with better ambient noise filtering
      const isVoiceDetected = (
        db > this.speakingThreshold &&              // General amplitude threshold
        voiceDb > (this.speakingThreshold + 8) &&   // Voice frequency range threshold (stricter)
        zeroCrossingRate > 0.02 &&                  // Voice typically has higher zero-crossing rate (stricter)
        zeroCrossingRate < 0.4 &&                   // But not too high (would be noise)
        (voiceDb - db) > -10                        // Voice signal should be reasonably strong in voice frequencies
      );

      // Debug logging for voice detection
      if (this.voiceDebugEnabled) {
        console.log(`🎤 Voice Detection - DB: ${db.toFixed(1)}, Voice DB: ${voiceDb.toFixed(1)}, ZCR: ${zeroCrossingRate.toFixed(3)}, Detected: ${isVoiceDetected}, Threshold: ${this.speakingThreshold}`);
      }

      // Only detect voice when AI is NOT speaking and waiting for user response
      if (
        isVoiceDetected &&
        !this.isAISpeaking &&
        this.waitingForResponse
      ) {
        if (!this.isUserSpeaking) {
          console.log("🎤 Enhanced voice detected - starting user speaking");
          this.onUserStartSpeaking();
        }
        if (this.speakingTimeout) {
          clearTimeout(this.speakingTimeout);
        }
        this.speakingTimeout = setTimeout(() => {
          if (this.isUserSpeaking) {
            console.log("🎤 Voice stopped - ending user speaking");
            this.onUserStopSpeaking();
          }
        }, 1500); // Reduced timeout for more responsive detection
      } else if (!isVoiceDetected && this.isUserSpeaking) {
        // Voice stopped - clear timeout and stop speaking
        if (this.speakingTimeout) {
          clearTimeout(this.speakingTimeout);
          this.speakingTimeout = null;
        }
        console.log("🎤 Voice stopped - ending user speaking");
        this.onUserStopSpeaking();
      }

      requestAnimationFrame(detectVoice);
    };

    detectVoice();
  }

  // ===== UI UPDATES =====
  updateMicrophoneUI(isActive) {
    if (!this.micButton || !this.micIcon) {
      console.log("❌ Mic button or icon not found");
      return;
    }

    console.log(
      "🎤 Updating mic UI - isActive:",
      isActive,
      "isUserSpeaking:",
      this.isUserSpeaking,
      "isAISpeaking:",
      this.isAISpeaking
    );

    // Remove all existing classes first
    this.micButton.classList.remove(
      "ring-4",
      "ring-green-400/50",
      "ring-red-400/50",
      "ring-2",
      "ring-green-400/30"
    );
    if (this.recordingAnimation) {
      this.recordingAnimation.classList.add("hidden");
    }
    if (this.pulseRing) {
      this.pulseRing.classList.add("hidden");
    }

    if (this.isAISpeaking) {
      // AI is speaking - show muted state with red ring
      console.log("🔴 AI Speaking - showing muted mic");
      this.micButton.classList.add("ring-4", "ring-red-400/50");
      this.micIcon.innerHTML = `
        <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clip-rule="evenodd"></path>
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"></path>
        </svg>
      `;
    } else if (this.isUserSpeaking && this.waitingForResponse) {
      // User is actively speaking - show active state with green ring and animations
      console.log("🟢 User Speaking - showing active mic with animations");
      this.micButton.classList.add("ring-4", "ring-green-400/50");
      if (this.recordingAnimation) {
        this.recordingAnimation.classList.remove("hidden");
      }
      if (this.pulseRing) {
        this.pulseRing.classList.remove("hidden");
      }
      this.micIcon.innerHTML = `
        <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path>
        </svg>
      `;
    } else if (this.waitingForResponse && !this.isAISpeaking) {
      // Ready to listen - show standby state with subtle green ring
      console.log("🟢 Ready to listen - showing standby mic");
      this.micButton.classList.add("ring-2", "ring-green-400/30");
      this.micIcon.innerHTML = `
        <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path>
        </svg>
      `;
    } else {
      // Default muted state - no ring
      console.log("⚪ Default state - showing muted mic");
      this.micIcon.innerHTML = `
        <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clip-rule="evenodd"></path>
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"></path>
        </svg>
      `;
    }
  }

  updateSpeakingIndicator(speaker) {
    if (speaker === "ai") {
      if (this.micStatusText) this.micStatusText.textContent = "AI Speaking...";
      if (this.micStatusSubtext)
        this.micStatusSubtext.textContent = "Microphone: Muted";
    } else if (speaker === "user") {
      if (this.micStatusText) this.micStatusText.textContent = "Listening...";
      if (this.micStatusSubtext)
        this.micStatusSubtext.textContent = "Speak now or click mic to toggle";
    }
  }

  // ===== WEBRTC SETUP =====
  async setupWebRTC() {
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    const audioTrack = this.stream.getAudioTracks()[0];
    this.pc.addTrack(audioTrack, this.stream);

    this.pc.ontrack = (event) => {
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.srcObject = new MediaStream([event.track]);
      document.body.appendChild(audio);
    };

    this.pc.oniceconnectionstatechange = () => {
      if (["failed", "disconnected"].includes(this.pc.iceConnectionState)) {
        this.updateStatus("Connection lost", "error");
        this.stopConversation();
      }
    };

    this.dc = this.pc.createDataChannel("conversation", { ordered: true });
    this.setupDataChannel();

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    const response = await fetch("/webrtc-signal/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": this.getCSRFToken(),
      },
      body: JSON.stringify({
        sdp: this.pc.localDescription.sdp,
        session_params: {
          model: "gpt-4o-realtime-preview-2024-12-17",
          speed: 1.0,
        },
      }),
    });

    if (!response.ok) throw new Error("Failed to establish connection");

    const data = await response.json();
    await this.pc.setRemoteDescription(
      new RTCSessionDescription({ type: "answer", sdp: data.sdp })
    );
  }

  configureSession() {
    this.updateSystemPrompt();

    const sessionUpdate = {
      type: "session.update",
      session: {
        instructions: this.systemPrompt,
        voice: "alloy",
        speed: 1.0,
        turn_detection: {
          type: "semantic_vad",
          eagerness: "low",
          create_response: true,
          interrupt_response: false,
        },
        input_audio_transcription: {
          model: "whisper-1",
          language: "en",
        },
      },
    };

    this.sendData(sessionUpdate);
  }

  sendData(data) {
    if (this.dc && this.dc.readyState === "open") {
      this.dc.send(JSON.stringify(data));
    }
  }

  setupDataChannel() {
    this.dc.onopen = () => {
      this.addMessage("system", "Connected to AI assistant");
      this.configureSession();
      if (this.micButton) {
        this.micButton.disabled = false;
      }
      this.updateMicrophoneUI(true); // Show mic as active for user to speak first
      if (this.micStatusText) {
        this.micStatusText.textContent = "Ready to listen";
      }
      if (this.micStatusSubtext) {
        this.micStatusSubtext.textContent = "Speak to begin the standup";
      }
    };

    this.dc.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleAIResponse(message);
      } catch (error) {
        console.error("Error parsing message:", error);
      }
    };

    this.dc.onclose = () => {
      this.addMessage("system", "Disconnected from AI assistant");
      if (this.micButton) {
        this.micButton.disabled = true;
      }
    };
  }

  // ===== DATA LOADING =====
  async loadPreviousDayData() {
    try {
      const response = await fetch("/get-previous-day-data/");
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          this.teamData = data.map((item) => ({
            name: item.name.charAt(0).toUpperCase() + item.name.slice(1),
            yesterdayWork: item.today_work || item.yesterday_work || "",
            currentQuestionStep: 0,
            responses: { yesterdayWork: "", todayWork: "", blockers: "" },
          }));
          this.updateSystemPrompt();
          // Initialize team members list after loading data
          this.initializeTeamMembersList();
          return;
        }
      }
      this.teamData = [
        {
          name: "Jeeva",
          yesterdayWork: "No previous data",
          currentQuestionStep: 0,
          responses: { yesterdayWork: "", todayWork: "", blockers: "" },
        },
        {
          name: "Ajay",
          yesterdayWork: "No previous data",
          currentQuestionStep: 0,
          responses: { yesterdayWork: "", todayWork: "", blockers: "" },
        },
        {
          name: "Mithun",
          yesterdayWork: "No previous data",
          currentQuestionStep: 0,
          responses: { yesterdayWork: "", todayWork: "", blockers: "" },
        },
      ];
      this.updateSystemPrompt();
      // Initialize team members list with default data
      this.initializeTeamMembersList();
    } catch (error) {
      console.error("Error loading previous day data:", error);
    }
  }

  updateSystemPrompt() {
    const memberList = this.teamData
      .map((m) => `- ${m.name}: ${m.yesterdayWork || "No previous work recorded"}`)
      .join("\n");
      
    // Get current member context
    const currentMember = this.teamData[this.currentMemberIndex];
    const nextMember = this.teamData[this.currentMemberIndex + 1];
    
    this.systemPrompt = `You are an experienced Scrum Master conducting a daily standup meeting.

Your job is to guide the meeting by going through each team member one by one.

The team members and their previous day's work are:
${memberList}

CURRENT CONTEXT:
- Currently interviewing: ${currentMember?.name || "First member"}
- Current question step: ${this.currentQuestionStep + 1}/3
- Next member: ${nextMember?.name || "None (end of standup)"}

For each member, ask only one question at a time from the following three:

1. What did you work on yesterday?
   - If they have previous work, reference it: "I know you were working on: [their previous work]. Can you tell me about your progress and any issues?"
   - If no previous work: "What did you work on yesterday?"

2. What will you work on today?

3. Are there any blockers or impediments?

STRICT RULES:
- ✅ Ask only ONE question at a time
- ✅ Wait for the team member to fully answer before moving to the next question
- ✅ After completing all 3 questions for a member, say: "Thanks, [name]. Let's move on to [next name]. Do you want to continue?"
- ✅ Wait for confirmation before proceeding to next member
- ❌ Never combine questions in one message
- ✅ Always be professional, supportive, and concise

Current member's previous work: "${currentMember?.yesterdayWork || "No previous work recorded"}"`;
  }

  // Create context-aware prompt for specific situations
  createContextPrompt(situation, memberName, previousWork) {
    const contexts = {
      'first_question': `You are asking ${memberName} about yesterday's work. ${previousWork && previousWork !== "No previous work recorded" 
        ? `Reference their previous work: "${previousWork}". Ask about their progress and any issues.` 
        : `Ask what they worked on yesterday.`}`,
      'transition': `You just finished asking ${memberName} all three standup questions. Thank them and ask to move to the next team member.`,
      'next_question': `You received ${memberName}'s answer. Now ask them the next standup question in sequence.`
    };
    
    return contexts[situation] || this.systemPrompt;
  }

  // ===== RESPONSE HANDLING =====
  handleAIResponse(message) {
    console.log("📨 AI Response:", message.type);

    if (
      [
        "conversation.item.input_audio_transcription.completed",
        "audio_transcription.done",
      ].includes(message.type)
    ) {
      if (message.transcript?.trim()) {
        this.lastUserResponse = message.transcript;
        this.addMessage("user", message.transcript);
        console.log("👤 User transcript received:", message.transcript);
        
        // Process the user response immediately
        this.processUserResponse(message.transcript);
        
        this.startAISpeaking(); // Start AI speaking when user input received
      }
      return;
    }

    if (message.type === "response.audio_transcript.done") {
      if (message.transcript?.trim()) {
        this.addMessage("assistant", message.transcript);
        console.log("🤖 AI transcript received:", message.transcript);
        this.stopAISpeaking(); // Stop AI speaking and allow user to speak
        this.processAIResponse(message.transcript);
      }
      return;
    }

    if (message.type === "error") {
      console.error("❌ AI Error:", message.error);
      this.updateStatus("Error: " + message.error.message, "error");
    }
  }

  processUserResponse(response) {
    const current = this.teamData[this.currentMemberIndex];
    if (!current) {
      console.log("❌ No current team member found");
      return;
    }

    const questionType = this.getCurrentQuestionType();
    console.log(`📝 Saving response for ${current.name} - ${questionType}: "${response}"`);
    
    // Save the response to the current member's data
    this.trackResponse(current.name, questionType, response);

    // Move to next question for this member
    this.currentQuestionStep++;
    
    console.log(`📊 Question step advanced to: ${this.currentQuestionStep}/3 for member: ${current.name}`);

    if (this.currentQuestionStep >= 3) {
      // All questions answered for current member
      console.log(`✅ All questions completed for ${current.name}`);
      this.advanceToNextMember();
    }
    
    // Update UI to reflect current state
    this.updateCurrentMemberUI();
  }

  askNextQuestion() {
    const current = this.teamData[this.currentMemberIndex];
    if (!current) return;

    const questionText = this.getCurrentQuestionText();
    const prompt = `
    You are conducting a standup meeting with ${current.name}.
    
    You have just received their response to the previous question.
    
    Now ask them the next question: "${questionText}"
    
    Keep your response short and direct. Only ask this one question.
    `;

    this.sendData({
      type: "session.update",
      session: { instructions: prompt },
    });
  }

  processAIResponse(aiTranscript) {
    const current = this.teamData[this.currentMemberIndex];
    if (!current) return;

    const transcript = aiTranscript.toLowerCase();
    console.log(`🤖 Processing AI response: "${aiTranscript}"`);

    // Check if AI is moving to next member (this should be checked first)
    if (
      transcript.includes("thank") ||
      transcript.includes("thanks") ||
      transcript.includes("next") ||
      transcript.includes("move on") ||
      transcript.includes("continue") ||
      transcript.includes("next member")
    ) {
      console.log("🔄 AI is transitioning to next member");
      // Don't advance here - let the confirmation process handle it
      return;
    }

    // Check if AI is asking about today's work
    if (
      transcript.includes("today") ||
      transcript.includes("work on today") ||
      transcript.includes("what will you work on today") ||
      transcript.includes("today's plan")
    ) {
      console.log("📅 AI is asking about today's work");
      this.currentQuestionStep = this.questionStates.TODAY;
    }
    // Check if AI is asking about blockers
    else if (
      transcript.includes("blocker") ||
      transcript.includes("impediment") ||
      transcript.includes("any blockers") ||
      transcript.includes("impediments")
    ) {
      console.log("🚧 AI is asking about blockers");
      this.currentQuestionStep = this.questionStates.BLOCKERS;
    }
    // Check if AI is asking about yesterday's work (first question)
    else if (
      transcript.includes("yesterday") ||
      transcript.includes("working on") ||
      transcript.includes("progress") ||
      transcript.includes("issues")
    ) {
      console.log("📊 AI is asking about yesterday's work");
      this.currentQuestionStep = this.questionStates.YESTERDAY;
    }

    // Update UI to reflect current state
    this.updateCurrentMemberUI();
  }

  advanceToNextMember() {
    if (this.standupCompleted) return;

    this.currentMemberIndex += 1;
    this.currentQuestionStep = this.questionStates.YESTERDAY;
    
    console.log(`🔄 Advanced to member index: ${this.currentMemberIndex}/${this.teamData.length}`);
    
    // Check if we've completed all members
    if (this.currentMemberIndex >= this.teamData.length) {
      console.log("🎉 All team members completed! Finishing standup...");
      this.standupCompleted = true;
      this.currentMemberIndex = this.teamData.length - 1; // Keep index valid
      this.addMessage("system", "🎉 Standup completed for all team members!");
      this.saveCurrentDayData();
      return;
    }
    
    // Update UI for the new current member
    this.updateCurrentMemberUI();
  }

  // ===== UTILITY FUNCTIONS =====
  trackResponse(memberName, questionType, response) {
    const member = this.teamData.find((m) => m.name === memberName);
    if (member) {
      if (!member.responses) {
        member.responses = { yesterdayWork: "", todayWork: "", blockers: "" };
      }
      member.responses[questionType] = response.trim();
      console.log(`✅ Tracked ${questionType} for ${memberName}: "${response}"`);
      console.log(`📋 Current responses for ${memberName}:`, member.responses);
    } else {
      console.error(`❌ Member ${memberName} not found in team data`);
    }
  }

  getCurrentQuestionType() {
    const questionTypes = ["yesterdayWork", "todayWork", "blockers"];
    return questionTypes[this.currentQuestionStep];
  }

  getCurrentQuestionText() {
    const questions = [
      "What did you work on yesterday?",
      "What will you work on today?",
      "Do you have any blockers or impediments?",
    ];
    return questions[this.currentQuestionStep];
  }

  // NEW: Initialize team members list
  initializeTeamMembersList() {
    const teamMembersList = document.getElementById("teamMembersList");
    if (!teamMembersList) return;

    teamMembersList.innerHTML = "";
    this.teamData.forEach((member, index) => {
      const isCurrent = index === this.currentMemberIndex;
      // Debug log to verify highlight logic
      console.log(
        `Rendering member: ${member.name}, index: ${index}, currentMemberIndex: ${this.currentMemberIndex}, isCurrent: ${isCurrent}`
      );
      const memberDiv = document.createElement("div");
      memberDiv.className =
        "flex items-center gap-3 p-2 rounded-lg transition-all duration-200 " +
        (isCurrent
          ? "bg-gradient-to-r from-blue-100 to-purple-100 border-2 border-primary scale-105"
          : "bg-white border border-gray-200 hover:bg-blue-50") +
        " cursor-pointer";
      memberDiv.id = `member-${index}`;

      memberDiv.innerHTML = `
        <div class="flex items-center gap-3 flex-1">
          <div class="w-8 h-8 rounded-full shadow-md flex items-center justify-center ${
            isCurrent
              ? "bg-gradient-to-br from-primary to-accent"
              : "bg-gray-200"
          }">
            <span class="text-base font-bold ${
              isCurrent ? "text-white" : "text-primary"
            }">
              ${member.name.charAt(0)}
            </span>
          </div>
          <div class="flex-1">
            <div class="text-sm font-semibold ${
              isCurrent ? "text-primary" : "text-gray-800"
            }">
              ${member.name}
              ${
                isCurrent
                  ? '<span class="ml-2 px-2 py-0.5 rounded-full bg-primary text-white text-xs font-bold animate-pulse">Current</span>'
                  : ""
              }
            </div>
            <div class="text-xs text-gray-500 truncate">${
              member.yesterdayWork
            }</div>
          </div>
        </div>
        <div class="flex items-center gap-1">
          ${
            isCurrent
              ? '<span class="w-2 h-2 rounded-full bg-primary animate-pulse"></span>'
              : '<span class="w-2 h-2 rounded-full bg-gray-300"></span>'
          }
        </div>
      `;
      teamMembersList.appendChild(memberDiv);
    });
  }

  updateCurrentMemberUI() {
    const member = this.teamData[this.currentMemberIndex];
    // Debug log to verify current member index
    console.log(
      "updateCurrentMemberUI: currentMemberIndex=",
      this.currentMemberIndex,
      "member=",
      member ? member.name : null
    );
    if (!member) return;

    // Update team members list highlighting
    this.initializeTeamMembersList();

    // Update current member display
    if (this.currentMemberDisplay) {
      const questionText = this.getCurrentQuestionText();
      this.currentMemberDisplay.textContent = `🎤 ${member.name} - ${questionText}`;
    }

    // Update question progress
    this.updateQuestionProgress();
  }

  // NEW: Update question progress bar
  updateQuestionProgress() {
    const questionProgress = document.getElementById("questionProgress");
    const questionCounter = document.getElementById("questionCounter");

    if (questionProgress && questionCounter) {
      const progress = ((this.currentQuestionStep + 1) / 3) * 100;
      questionProgress.style.width = `${progress}%`;
      questionCounter.textContent = `${this.currentQuestionStep + 1}/3`;
    }
  }

  addMessage(role, content) {
    if (!content?.trim()) return;

    if (
      this.conversationArea.children.length === 1 &&
      this.conversationArea.children[0].classList.contains("text-gray-500")
    ) {
      this.conversationArea.innerHTML = "";
    }

    const messageDiv = document.createElement("div");
    messageDiv.className = `mb-6 ${
      role === "user"
        ? "flex justify-end items-end gap-3"
        : role === "assistant"
        ? "flex justify-start items-end gap-3"
        : "flex justify-center"
    }`;

    if (role === "system") {
      // Unique, compact, pill-style system message
      messageDiv.innerHTML = `
        <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-gray-200 via-primary/10 to-accent/10 border border-primary/20 shadow-sm mx-auto text-xs font-semibold text-primary">
          <span class="text-base">⚙️</span>
          <span>${this.escapeHtml(content)}</span>
          <span class="ml-2 text-[10px] text-gray-400">${new Date().toLocaleTimeString()}</span>
        </div>
      `;
    } else {
      // User and AI messages with avatars and chat bubbles
      const isUser = role === "user";
      const avatarClass = isUser
        ? "bg-gradient-to-br from-blue-500 to-blue-600"
        : "bg-gradient-to-br from-purple-500 to-purple-600";
      const bubbleClass = isUser
        ? "bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-2xl rounded-br-md shadow-lg"
        : "bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-2xl rounded-bl-md shadow-lg";
      const avatarIcon = isUser ? "👤" : "🤖";
      const roleLabel = isUser ? "You" : "AI Assistant";

      messageDiv.innerHTML = `
        ${
          !isUser
            ? `
          <div class="w-8 h-8 ${avatarClass} rounded-full flex items-center justify-center shadow-md flex-shrink-0">
            <span class="text-white text-sm">${avatarIcon}</span>
          </div>
        `
            : ""
        }
        <div class="max-w-xs lg:max-w-md">
          <div class="${bubbleClass} p-4 shadow-lg">
            <div class="flex items-center gap-2 mb-2">
              <div class="font-medium text-xs opacity-90">${roleLabel}</div>
              <div class="text-xs opacity-70">${new Date().toLocaleTimeString()}</div>
            </div>
            <div class="text-sm leading-relaxed">${this.escapeHtml(
              content
            )}</div>
          </div>
        </div>
        ${
          isUser
            ? `
          <div class="w-8 h-8 ${avatarClass} rounded-full flex items-center justify-center shadow-md flex-shrink-0">
            <span class="text-white text-sm">${avatarIcon}</span>
          </div>
        `
            : ""
        }
      `;
    }

    this.conversationArea.appendChild(messageDiv);
    this.conversationArea.scrollTop = this.conversationArea.scrollHeight;
  }

  escapeHtml(text) {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",

      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  async saveCurrentDayData() {
    try {
      const today = new Date();
      const todayStr = today.toLocaleDateString("en-GB").replace(/-/g, "/");

      console.log("💾 Preparing to save standup data...");
      console.log("📊 Current team data:", this.teamData);

      const jsonData = this.teamData.map((member, index) => {
        const data = {
          no: index + 1,
          date: todayStr,
          name: member.name.toLowerCase(),
          yesterday_work: member.responses?.yesterdayWork || member.yesterdayWork,
          today_work: member.responses?.todayWork || "",
          blockers: member.responses?.blockers || "",
        };
        console.log(`📝 Member ${member.name} data:`, data);
        return data;
      });

      console.log("📤 Sending data to server:", jsonData);

      const response = await fetch("/save-standup-data/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": this.getCSRFToken(),
        },
        body: JSON.stringify(jsonData),
      });

      if (response.ok) {
        const result = await response.json();
        console.log("✅ Data saved successfully:", result);
        this.addMessage("system", `✅ Standup data saved for ${todayStr}`);
      } else {
        console.error("❌ Failed to save to JSON file, status:", response.status);
        const errorText = await response.text();
        console.error("❌ Error response:", errorText);
      }
    } catch (error) {
      console.error("❌ Error saving standup data:", error);
    }
  }

  // ===== CLEANUP =====
  async stopConversation() {
    this.isConnected = false;
    this.isRecording = false;
    this.isAISpeaking = false;
    this.isUserSpeaking = false;
    this.waitingForResponse = false;

    if (this.speakingTimeout) {
      clearTimeout(this.speakingTimeout);
      this.speakingTimeout = null;
    }

    if (this.audioContext) {
      // Clean up audio nodes
      if (this.gainNode) {
        this.gainNode.disconnect();
        this.gainNode = null;
      }
      if (this.microphone) {
        this.microphone.disconnect();
        this.microphone = null;
      }
      if (this.analyser) {
        this.analyser.disconnect();
        this.analyser = null;
      }
      
      this.audioContext.close();
      this.audioContext = null;
      console.log("🎵 Audio context and nodes cleaned up");
    }

    // Stop the microphone track
    if (this.track && this.track.readyState === "live") {
      this.track.stop();
      console.log("User microphone track stopped.");
    }

    if (this.standupCompleted || this.currentMemberIndex > 0) {
      await this.saveCurrentDayData();
    }

    if (this.dc) {
      this.dc.close();
      this.dc = null;
    }

    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    this.updateUI();
    this.updateStatus("Disconnected - Data saved", "info");
    this.addMessage("system", "Conversation ended - Standup data saved");

    if (this.micButton) {
      this.micButton.disabled = true;
    }
    this.updateMicrophoneUI(false);
    if (this.micStatusText) {
      this.micStatusText.textContent = "Click 'Start Conversation' to begin";
    }
    if (this.micStatusSubtext) {
      this.micStatusSubtext.textContent =
        "Microphone will activate automatically";
    }
    if (this.aiSpeakingIndicator) {
      this.aiSpeakingIndicator.classList.add("hidden");
    }
    if (this.userSpeakingIndicator) {
      this.userSpeakingIndicator.classList.add("hidden");
    }
  }

  cleanup() {
    if (this.isRecording) {
      this.stopConversation();
    }
  }

  updateUI() {
    this.startBtn.disabled = this.isConnected;
    this.stopBtn.disabled = !this.isConnected;
    this.connectionStatus.textContent = this.isConnected
      ? "Connected"
      : "Disconnected";
    this.connectionStatus.className = `px-3 py-1 rounded-full text-sm font-medium ${
      this.isConnected
        ? "bg-green-200 text-green-800"
        : "bg-gray-200 text-gray-700"
    }`;
  }

  updateStatus(message, type = "info") {
    this.statusMessage.textContent = message;
    this.statusMessage.className = `mt-4 p-4 rounded-xl ${
      type === "success"
        ? "bg-green-100 text-green-800"
        : type === "error"
        ? "bg-red-100 text-red-800"
        : "bg-blue-100 text-blue-800"
    }`;
    this.statusMessage.classList.remove("hidden");
    setTimeout(() => this.statusMessage.classList.add("hidden"), 5000);
  }

  showLoading(show) {
    this.loadingSpinner.classList.toggle("hidden", !show);
  }

  getCSRFToken() {
    const name = "csrftoken";
    let cookieValue = null;
    if (document.cookie && document.cookie !== "") {
      const cookies = document.cookie.split(";");
      for (let i = 0; i < cookies.length; i++) {
        const cookie = cookies[i].trim();
        if (cookie.substring(0, name.length + 1) === name + "=") {
          cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
        }
      }
    }
    return cookieValue;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  // Test audio constraints support on page load
  const audioTest = await VoiceAssistant.testAudioConstraints();
  console.log("🎤 Audio Constraints Test Result:", audioTest);
  
  // Create the voice assistant instance
  const voiceAssistant = new VoiceAssistant();
  
  // Optional: Add keyboard shortcuts for audio control
  document.addEventListener("keydown", (event) => {
    // Press 'M' to toggle microphone volume between normal and boosted
    if (event.key.toLowerCase() === 'm' && event.ctrlKey) {
      event.preventDefault();
      const currentLevel = voiceAssistant.gainNode?.gain.value || 1.0;
      const newLevel = currentLevel >= 1.5 ? 1.0 : 1.5;
      voiceAssistant.setMicrophoneVolume(newLevel);
    }
    
    // Press 'T' to adjust speaking threshold
    if (event.key.toLowerCase() === 't' && event.ctrlKey) {
      event.preventDefault();
      const newThreshold = voiceAssistant.speakingThreshold <= -45 ? -35 : -45;
      voiceAssistant.setSpeakingThreshold(newThreshold);
    }
    
    // Press 'D' to toggle voice detection debugging
    if (event.key.toLowerCase() === 'd' && event.ctrlKey) {
      event.preventDefault();
      voiceAssistant.enableVoiceDebug(!voiceAssistant.voiceDebugEnabled);
    }
    
    // Press 'F' to force voice detection (for testing)
    if (event.key.toLowerCase() === 'f' && event.ctrlKey) {
      event.preventDefault();
      voiceAssistant.forceVoiceDetection();
    }
  });
  
  // Make it globally accessible for debugging
  window.voiceAssistant = voiceAssistant;
});
