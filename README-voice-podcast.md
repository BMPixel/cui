# CUI Voice & Podcast Features

## Overview

This document describes the voice and podcast features added to CUI (Claude Code Web UI). These features enable:

1. **One-click podcast generation** from task conversations using Podcastfy
2. **Real-time voice conversation** using LiveKit integration with Claude Code
3. **Multi-provider dictation** with switchable backends (OpenAI Whisper, GPT-4o, Gemini)

## Features

### 1. Podcast Generation

Transform any task conversation into a professional dual-host podcast format.

- **One-click generation**: Click "Generate Podcast" button on any task
- **Dual-host format**: Natural conversation between two AI hosts
- **Language support**: English and Chinese with customizable voices
- **Show notes**: Automatically generated chapters, key points, and next steps
- **Quick generation**: Produces ≤8 minute podcasts in <30 seconds

### 2. Real-time Voice Conversation

Engage with Claude Code through natural voice interaction.

- **LiveKit integration**: WebRTC-based real-time audio streaming
- **Push-to-talk mode**: Default mode for clear communication
- **Low latency**: <1.2s end-to-end response time
- **Room-based**: Each conversation has its own LiveKit room

### 3. Multi-provider Dictation

Flexible speech-to-text with switchable providers.

- **Provider options**:
  - OpenAI Whisper: Robust and accurate
  - GPT-4o Transcribe: Advanced model with better context understanding
  - Gemini: Google's alternative (optional)
- **Browser compatibility**: Supports both WebM and MP4 audio formats
- **Settings integration**: Switch providers from settings page

## Architecture

### Technology Stack

- **Backend**: Express.js (TypeScript) on port 3001
- **Frontend**: React with Vite
- **Real-time**: LiveKit WebRTC
- **Audio Processing**: Multer for uploads
- **Testing**: Vitest with TDD Guard enforcement

### API Endpoints

#### Podcast Generation
```
POST /api/podcast
Body: { taskId, lang?, voices? }
Response: { audioUrl, showNotes, durationSec }
```

#### Voice Conversation
```
POST /api/voice/start
Body: { taskId }
Response: { room, token, hint }

POST /api/voice/stop
Response: { ok: true }
```

#### Dictation
```
POST /api/dictation/transcribe?provider=<provider>
Body: FormData with audio file
Response: { text, language?, confidence? }
```

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

```env
# LiveKit Configuration
LIVEKIT_URL=wss://your-livekit-server.com
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret

# Podcast Configuration
PODCASTFY_URL=http://localhost:8123/api/generate
PODCAST_OUTPUT_DIR=public/podcasts

# Dictation Providers
OPENAI_API_KEY=your-openai-key
GOOGLE_AI_API_KEY=your-google-key (optional)
```

### Voice Configuration

Customize podcast voices per language:

```env
# English voices
PODCAST_EN_VOICE_A=Alloy
PODCAST_EN_VOICE_B=Verse

# Chinese voices
PODCAST_ZH_VOICE_A=zh-male-1
PODCAST_ZH_VOICE_B=zh-female-1
```

## Development

### Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your API keys
```

3. Start development server:
```bash
npm run dev
```

### Testing

The project enforces Test-Driven Development (TDD):

```bash
# Run all tests
npm test

# Run unit tests only
npm run unit-tests

# Run integration tests
npm run integration-tests

# Watch mode for development
npm run test:watch

# Coverage report
npm run test:coverage
```

### Quality Enforcement

#### TDD Guard
- Enforces writing tests before implementation
- Integrated with Vitest reporter
- Blocks code changes without failing tests

#### Pre-commit Hooks
- Code formatting with Prettier
- Linting with ESLint
- Type checking with TypeScript
- Unit test execution

#### CI Pipeline
- GitHub Actions workflow
- Required checks before merge
- Coverage thresholds enforcement

## Usage

### Generate a Podcast

1. Navigate to any task detail page
2. Click the "Generate Podcast" button
3. Wait for generation (typically <30 seconds)
4. Play the generated podcast directly in the browser
5. Review show notes for chapters and key points

### Start Voice Conversation

1. Click the microphone icon on a task
2. Accept microphone permissions
3. Hold spacebar (PTT mode) or toggle for continuous
4. Speak naturally to Claude Code
5. Release to hear the response

### Use Dictation

1. Click the dictation input field
2. Select provider from settings if needed
3. Click record and speak
4. Stop recording to transcribe
5. Text appears in the input field

## Troubleshooting

### Common Issues

#### Podcast generation fails
- Check Podcastfy service is running
- Verify PODCASTFY_URL in .env
- Ensure public/podcasts directory exists

#### Voice mode not connecting
- Verify LiveKit credentials
- Check voice-mode CLI is installed
- Ensure WebRTC ports are open

#### Dictation not working
- Check API keys are valid
- Verify audio format support
- Check upload size limits

### Debug Mode

Enable debug logging:
```bash
LOG_LEVEL=debug npm run dev
```

### Performance Tips

- Use OpenAI Whisper for cost-effective dictation
- Enable caching for repeated podcast generation
- Monitor LiveKit room cleanup
- Set appropriate upload limits

## Security Considerations

### API Key Protection
- Never commit .env files
- Use environment-specific keys
- Rotate keys regularly

### File Upload Security
- Validates audio MIME types
- Enforces 20MB upload limit
- Sanitizes file paths

### LiveKit Security
- Room-based isolation
- Token-based authentication
- Automatic room cleanup

## Future Enhancements

### Planned Features
- Speaker diarization with WhisperX
- Multi-language podcast support
- Voice cloning for personalized hosts
- Podcast RSS feed generation
- Voice command shortcuts

### Performance Optimizations
- CDN integration for podcasts
- Audio compression pipeline
- LiveKit connection pooling
- Caching layer for transcriptions

## Contributing

Please follow the TDD workflow:

1. Write failing tests first
2. Implement minimal code to pass
3. Refactor with confidence
4. Ensure all quality gates pass
5. Submit PR with comprehensive tests

## License

Apache License 2.0 - See LICENSE file for details