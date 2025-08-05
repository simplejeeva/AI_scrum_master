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
    this.speakingThreshold = -50;
    this.speakingTimeout = null;

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

      // Define constraints
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      };

      // Use constraints here
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.track = this.stream.getAudioTracks()[0];

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
    this.updateMicrophoneUI(true);
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
    this.updateMicrophoneUI(true);

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

    if (this.userSpeakingIndicator) {
      this.userSpeakingIndicator.classList.remove("hidden");
    }
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

    // Process user response and start AI speaking
    if (this.waitingForResponse && this.lastUserResponse.trim()) {
      console.log("📝 Processing user response:", this.lastUserResponse);
      this.processUserResponse(this.lastUserResponse);
      this.lastUserResponse = "";
      this.waitingForResponse = false;
      this.startAISpeaking(); // Start AI speaking again
    }
  }

  // ===== AUDIO ANALYSIS =====
  setupAudioAnalysis() {
    if (!this.stream) return;

    this.audioContext = new (window.AudioContext ||
      window.webkitAudioContext)();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;

    this.microphone = this.audioContext.createMediaStreamSource(this.stream);
    this.microphone.connect(this.analyser);

    this.startVoiceDetection();
  }

  // Enhanced voice detection with immediate UI updates
  startVoiceDetection() {
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const detectVoice = () => {
      if (!this.isConnected) return;

      this.analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / bufferLength;
      const db = 20 * Math.log10(average / 255);

      // Only detect voice when AI is NOT speaking and waiting for user response
      if (
        db > this.speakingThreshold &&
        !this.isAISpeaking &&
        this.waitingForResponse
      ) {
        if (!this.isUserSpeaking) {
          console.log("🎤 Voice detected - starting user speaking");
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
        }, 2000);
      } else if (db <= this.speakingThreshold && this.isUserSpeaking) {
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
      .map((m) => `- ${m.name}: ${m.yesterdayWork}`)
      .join("\n");
    this.systemPrompt = `
      You are an experienced Scrum Master conducting a daily standup meeting.
      
      Your job is to guide the meeting by going through each team member one by one.
      
      The team members and their previous day's work are:
      ${memberList}
      
      Start with ${this.teamData[0]?.name}.
      
      For each member, ask only one question at a time from the following three:
      
      1. What did you work on yesterday?
         - Include: "I know you were working on: {{yesterdayWork}}. Can you tell me about your progress on this work and if you're facing any issues?"
      
      2. What will you work on today?
      
      3. Are there any blockers or impediments?
      
      Strict rules:
      - ✅ Ask only **one question at a time**.
      - ✅ Wait for the team member to fully answer before moving to the next question.
      - ✅ After completing all 3 questions for a member, you **must say**:
      
          **"Thanks, {{currentMember}}. Let's move on to {{nextMember}}. Do you want to continue?"**
      
      - ✅ Wait for the user to reply with "yes", "ok", or similar confirmation before proceeding.
      - ❌ Do not automatically continue without confirmation.
      - ❌ Never combine questions in one message.
      - ✅ Always reference their task when asking about yesterday's work.
      
      Tone:
      - Be professional, supportive, and concise.
      - Keep the flow clear and structured: one member at a time, one question at a time.
      
      Example flow:
      ---
      AI: Hi Jeeva. What did you work on yesterday? I know you were working on: "Today I am Warka." Can you tell me about your progress on this work and if you're facing any issues?
      
      User: I completed it.
      
      AI: Great to hear that, Jeeva. What will you be working on today?
      
      User: A POC related to Scrum Master.
      
      AI: Are there any blockers or impediments?
      
      User: No blockers.
      
      AI: Thanks, Jeeva. Let's move on to Ajay. Do you want to continue?
      ---
      `;
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
    if (!current) return;

    const questionType = this.getCurrentQuestionType();
    this.trackResponse(current.name, questionType, response);

    // Move to next question
    this.currentQuestionStep++;

    if (this.currentQuestionStep >= 3) {
      // All questions answered for current member
      this.advanceToNextMember();
    } else {
      // Ask next question
      this.askNextQuestion();
    }
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

    // Check if AI is asking about today's work
    if (
      transcript.includes("today") ||
      transcript.includes("work on today") ||
      transcript.includes("what will you work on today") ||
      transcript.includes("today's plan")
    ) {
      this.currentQuestionStep = this.questionStates.TODAY;
    }
    // Check if AI is asking about blockers
    else if (
      transcript.includes("blocker") ||
      transcript.includes("impediment") ||
      transcript.includes("any blockers") ||
      transcript.includes("impediments")
    ) {
      this.currentQuestionStep = this.questionStates.BLOCKERS;
    }
    // Check if AI is asking about yesterday's work (first question)
    else if (
      transcript.includes("yesterday") ||
      transcript.includes("working on") ||
      transcript.includes("progress") ||
      transcript.includes("issues")
    ) {
      this.currentQuestionStep = this.questionStates.YESTERDAY;
    }
    // Check if AI is moving to next member
    else if (
      transcript.includes("thank you") ||
      transcript.includes("next") ||
      transcript.includes("move on") ||
      transcript.includes("next member")
    ) {
      this.advanceToNextMember();
    }
  }

  advanceToNextMember() {
    if (this.standupCompleted) return;

    this.currentMemberIndex += 1;
    this.currentQuestionStep = this.questionStates.YESTERDAY;
    // Debug log to verify index change
    console.log(
      "advanceToNextMember: currentMemberIndex=",
      this.currentMemberIndex
    );
    // Always update the team member list highlight
    this.updateCurrentMemberUI();
  }

  // ===== UTILITY FUNCTIONS =====
  trackResponse(memberName, questionType, response) {
    const member = this.teamData.find((m) => m.name === memberName);
    if (member) {
      member.responses[questionType] = response;
      console.log(`Tracked ${questionType} for ${memberName}: "${response}"`);
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

      const jsonData = this.teamData.map((member, index) => ({
        no: index + 1,
        date: todayStr,
        name: member.name.toLowerCase(),
        yesterday_work: member.responses.yesterdayWork || member.yesterdayWork,
        today_work: member.responses.todayWork || "",
        blockers: member.responses.blockers || "",
      }));

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
        this.addMessage("system", `✅ Standup data saved for ${todayStr}`);
      } else {
        console.error("❌ Failed to save to JSON file");
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
      this.audioContext.close();
      this.audioContext = null;
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

document.addEventListener("DOMContentLoaded", () => {
  new VoiceAssistant();
});
