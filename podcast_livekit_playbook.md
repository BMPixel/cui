# CUI Voice & Podcast Upgrade — PRD + System Design + Development Playbook

> **Overview**: This playbook guides the implementation of podcast generation, real-time voice conversation, and dictation features for CUI (Claude Code Web UI), with built-in quality gates via TDD Guard, Git hooks, and CI.

**Branch**: feat/podcast-livekit  
**Architecture**: Express.js (TypeScript) + React (Vite) + Single Port 3001  
**Key Features**:
1. One-click podcast generation from task conversations (Podcastfy)
2. Real-time voice conversation similar to ChatGPT Advanced Voice (LiveKit + voice-mode + Claude Code)
3. Dictation with switchable providers: gemini / openai-whisper / openai-gpt4o-transcribe
4. Quality enforcement: Claude Code Hooks + TDD Guard + pre-commit + CI

---

## CUI Voice & Podcast Upgrade — PRD + System Design + Development Playbook

（含新增章节：Hooks + TDD Guard + Git 钩子 + CI）

分支：feat/podcast-voice-dictation（建议）
运行架构：Express.js(Typescript) + React(Vite) + 单端口 3001
目标功能：
1）任务一键生成播客（Podcastfy）
2）类 ChatGPT Advanced Voice 的实时语音对话（LiveKit + voice-mode + Claude Code）
3）听写（Dictation）可切换提供商：gemini / openai-whisper / openai-gpt4o-transcribe
4）新增：Claude Code Hooks + TDD Guard + pre-commit + CI 以"规范→阻断→验证"强制收敛，防止 agent 跑偏

⸻

## 1. PRD（产品需求）

### 1.1 问题与价值
- CUI 用户需要离屏消费任务进度与结论：将任务会话转为双主持人播客，随时收听。
- 需要实时语音交互以推进任务、提问进度、下达下一步指令。
- 需要稳定听写与提供商切换（成本/准确度/延迟可权衡）。
- 需要把TDD 与安全约束落到硬性流程：Claude Code 每次写改前必须过关，提交前与 CI 阶段再兜底。

### 1.2 成功标准（验收）
- 任务详情页出现 Generate Podcast 按钮；30 秒内产出 ≤ 8 分钟 .m4a，iPhone/Safari 可播；生成 show notes（章节/要点/下一步）。
- Voice Converse：按下后加入 LiveKit 房间，与 Claude Code（经 voice-mode）语音往返，平均端到端延迟 ≤ 1.2s。
- Dictation Provider 切换：设置页切换后，前端录音上传经 /api/dictation/transcribe?provider=... 返回文本稳定。
- Hooks + Guard：
  - Claude Code 的任何写/改走 PreToolUse → tdd-guard，若无 red→green 证据直接拒绝。
  - pre-commit 阶段自动 format + lint + typecheck + unit test，失败即阻断。
  - CI 对齐本地策略：typecheck + lint + test + build 全绿才允许合并。

### 1.3 非目标（MVP 外）
- 语音分离/说话人标注（WhisperX/pyannote）仅作为后续增强。
- 多租户/跨实例的 voice-mode 池化与任务路由。
- 生产级 Podcast CDN/转码流水线（MVP 用本地静态目录）。

⸻

## 2. System Design（系统设计）

### 2.1 组件与数据流（ASCII）

```
[Browser UI]
  |             ┌───────────── Express (3001) ──────────────┐
  |  /api/podcast  /api/voice/*   /api/dictation/transcribe |
  v             │                                              │
[Task View] -> [Podcast Controller] -> [Podcastfy Adapter] -> [public/podcasts/*.m4a]
   |                                                     ^
   |<------------- audioUrl + show notes ----------------|
   |
[Voice Toggle] -> [Voice Controller] -> spawn voice-mode (MCP) -> Claude Code
   |                 |                    ^
   |                 v                    |
   |             LiveKit token <----------|
   |------------- Join LiveKit room <----> voice-mode audio loopback

[DictationInput] -- MediaRecorder(audio/webm, mp4) --> /api/dictation/transcribe?provider=...
                                                -> OpenAI Whisper / GPT-4o-transcribe -> text
```

### 2.2 模块与目录

```
server/
  routes/
    podcast.ts         # POST /api/podcast
    voice.ts           # POST /api/voice/start|stop
    dictation.ts       # POST /api/dictation/transcribe
  lib/
    config.ts
    podcast/
      index.ts         # provider 抽象
      podcastfy.ts     # Podcastfy 适配
    voice/voiceMode.ts # spawn voice-mode + LiveKit token
    dictation/
      index.ts
      openaiWhisper.ts
      openaiGpt4o.ts
  utils/taskSummary.ts # 从任务会话生成「双主持人脚本 + show notes」

client/src/
  components/TaskActions/PodcastButton.tsx
  components/TaskActions/VoiceToggle.tsx
  components/Dictation/DictationInput.tsx
  pages/SettingsVoiceAndPodcast.tsx
  state/settings.ts    # (Zustand) 存 provider/voice 等
public/podcasts/
```

### 2.3 API 契约（MVP）
- **POST /api/podcast**
  - Request: `{ taskId, lang?, voices? }`
  - Response: `{ audioUrl, showNotes:[{title,bullets[]}], durationSec? }`
- **POST /api/voice/start**
  - Request: `{ taskId }`
  - Response: `{ room, token, hint }`
- **POST /api/voice/stop** → `{ ok:true }`
- **POST /api/dictation/transcribe?provider=openai-whisper|openai-gpt4o-transcribe|gemini**
  - FormData: audio（webm/mp4）
  - Response: `{ text, language?, confidence? }`

### 2.4 配置（.env.example 摘要）

```env
PORT=3001
LIVEKIT_URL=...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
VOICE_MODE_CMD=voice-mode
VOICE_ROOM_PREFIX=cui
VOICE_DEFAULT_MODE=ptt

PODCAST_PROVIDER=podcastfy
PODCASTFY_URL=http://localhost:8123/api/generate
PODCAST_OUTPUT_DIR=public/podcasts
PODCAST_DEFAULT_LANG=en-US
PODCAST_EN_VOICE_A=Alloy
PODCAST_EN_VOICE_B=Verse
PODCAST_ZH_VOICE_A=zh-male-1
PODCAST_ZH_VOICE_B=zh-female-1

DICTATION_DEFAULT_PROVIDER=openai-gpt4o-transcribe
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_WHISPER_MODEL=whisper-1
OPENAI_GPT4O_TRANSCRIBE_MODEL=gpt-4o-transcribe
```

⸻

## 3. Detailed Development Guide（详细开发指引，Spec→TDD→实现）

### 3.1 初始化（提交 000）
- 新增/确认脚本：typecheck、lint、test（Vitest + Supertest + RTL）、build
- 引入 Dev 依赖（Vitest/RTL/Supertest/eslint/ts/…）
- .env.example 写全；README-voice-podcast.md 起草

### 3.2 功能 A：Podcast（Podcastfy）
1. **先写测试**
   - server/routes/podcast.spec.ts：缺 taskId→400；正常→200 且返回 /podcasts/*.m4a；上游报错→500
   - client/PodcastButton.spec.tsx：点击→调用 API→渲染 <audio> 与 show notes
2. **实现**
   - buildPodcastScript(taskId)：从任务记录产出"双主持人脚本 + sections"
   - PodcastfyProvider.generate()：POST 脚本→落地 m4a→返回路径
   - Express 挂载静态 /podcasts
3. **验收**：本地/iPhone 播放正常，30 秒内可得

### 3.3 功能 B：Voice（LiveKit + voice-mode）
1. **先写测试**
   - server/lib/voice/voiceMode.spec.ts：start 首次 spawn、二次幂等、stop kill
   - server/routes/voice.spec.ts：参数校验、返回 room+token
   - client/VoiceToggle.spec.tsx：start→UI 变更；stop→还原
2. **实现**
   - startVoiceMode(room): spawn(VOICE_MODE_CMD, ['--livekit-url', ...]) + 监听退出
   - mintLiveKitToken(identity, room)（livekit-server-sdk）
3. **验收**：加入房间，voice-mode 有日志；退出清理子进程

### 3.4 功能 C：Dictation Provider 切换
1. **先写测试**
   - server/routes/dictation.spec.ts：缺文件→400；provider 正常→200；未知→400/422
   - client/DictationInput.spec.tsx：切换 provider 后 query 正确
2. **实现**
   - openaiWhisper.ts / openaiGpt4o.ts（/audio/transcriptions）
   - DictationInput.tsx 用 MediaRecorder→FormData 上传
3. **验收**：英/中文短录音稳定转写；切 provider 生效

⸻

## 4. Hooks + TDD Guard + Git 钩子 + CI（新增章节，强制收敛）

### 4.1 目标
- 让 Claude Code 在写/改之前，必须满足 TDD 流程（有失败测试→写代码→转绿）。
- 在 pre-commit 阶段拦下绝大多数自动化能发现的问题（格式/类型/单测）。
- CI 对齐本地策略，PR 必须全绿。
- 对 MCP 写入做路径与权限校验，拒绝越权或危险操作。

### 4.2 安装 TDD Guard（Vitest 报告器）

```bash
npm i -g tdd-guard
pnpm add -D vitest tdd-guard-vitest
```

vitest.config.ts 增加：

```typescript
import { VitestReporter } from 'tdd-guard-vitest'
export default defineConfig({
  test: {
    reporters: ['default', new VitestReporter(process.cwd())],
    coverage: { provider: 'v8', thresholds: { lines: 80, branches: 70, functions: 80, statements: 80 } }
  }
})
```

### 4.3 配置 Claude Code Hooks（项目级 .claude/settings.json）

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "matcher": ".*", "hooks": [
        { "type": "command", "command": "echo '[Guard] RED first: write failing tests before code.' >&2" }
      ]}
    ],
    "PreToolUse": [
      { "matcher": "Write|Edit|MultiEdit|TodoWrite", "hooks": [
        { "type": "command", "command": "tdd-guard" }
      ]},
      { "matcher": "mcp__.*__write.*", "hooks": [
        { "type": "command", "command": "$CLAUDE_PROJECT_DIR/scripts/validate-mcp-write.sh" }
      ]}
    ],
    "PostToolUse": [
      { "matcher": "Write|Edit|MultiEdit", "hooks": [
        { "type": "command", "command": "pnpm -s format:fix && pnpm -s lint -f" }
      ]}
    ]
  }
}
```

### 4.4 写入保护脚本 scripts/validate-mcp-write.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
payload="$(cat)"  # hooks JSON from stdin
proj="${CLAUDE_PROJECT_DIR:-$(pwd)}"
abspath="$(python3 - <<'PY'
import os,sys,json
p=json.load(sys.stdin).get("tool_input",{})
fp=p.get("path") or p.get("file_path") or ""
print(os.path.abspath(fp) if fp else "")
PY
<<<"$payload")"

# 保护路径
case "$abspath" in
  "$proj/.env"*) echo '{"decision":"deny","reason":".env is protected."}'; exit 0;;
  "$proj/.git"*) echo '{"decision":"deny","reason":".git is protected."}'; exit 0;;
esac

# 阻止跳出仓库
if [[ "$abspath" != "$proj/"* ]]; then
  echo '{"decision":"deny","reason":"Path traversal outside project is blocked."}'; exit 0
fi

echo '{"decision":"approve","reason":"OK"}'
```

让 Claude Code 赋可执行权限：`chmod +x scripts/validate-mcp-write.sh`

### 4.5 Git 钩子（Husky + lint-staged）

```bash
pnpm add -D husky lint-staged @commitlint/{config-conventional,cli}
pnpm dlx husky init

# .husky/pre-commit
cat > .husky/pre-commit <<'SH'
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"
pnpm -s lint-staged
pnpm -s typecheck
pnpm -s test -- --run
SH
chmod +x .husky/pre-commit

# .husky/pre-push
cat > .husky/pre-push <<'SH'
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"
pnpm -s test -- --run
pnpm -s build
SH
chmod +x .husky/pre-push

# lint-staged
cat > .lintstagedrc.json <<'JSON'
{
  "*.{ts,tsx,js,jsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md,yml,yaml}": ["prettier --write"]
}
JSON

# commit-msg 规范（可选）
echo 'export default {extends: ["@commitlint/config-conventional"]}' > commitlint.config.cjs
```

### 4.6 CI（GitHub Actions）

.github/workflows/ci.yml：

```yaml
name: ci
on:
  push: { branches: [ main ] }
  pull_request:
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test -- --run --coverage
      - run: pnpm build
```

建议把 ci 设为 Branch protection 的 Required status check。

### 4.7（可选）MCP 安全体检
- 选用你信任的 MCP 扫描器（如 mcp-scan）做静态/动态检查；把报告产物纳入 reports/ 并在 CI 上传为 artifact。
- 本地脚本（示例）：
  - pnpm mcp:static → 对 .claude/settings.json、MCP server 清单做静态审计
  - pnpm mcp:dynamic → 对一次真实会话日志做动态审计

⸻

## 5. 测试策略
- **单元测试**：server/routes/*.spec.ts、server/lib/*/*.spec.ts、client/*/*.spec.tsx
- **契约测试**：Mock 上游（Podcastfy/OpenAI），验证协议与错误处理
- **E2E（轻量）**：Playwright 1 条烟囱
  - 打开任务详情页 → 生成播客 → <audio> 出现
  - 设置页切换 dictation provider → 下一次录音请求带对的 query

⸻

## 6. 交付与提交切分
- **000** chore(ci/dev): vitest/rtl/supertest/eslint/ts/husky/lint-staged/.env.example/PR 模板
- **Axx** feat(podcast): /api/podcast + provider + 前端按钮 + tests
- **Bxx** feat(voice): /api/voice/start|stop + spawn + LiveKit token + UI + tests
- **Cxx** feat(dictation): /api/dictation/transcribe + providers + UI + tests
- **D00** test(e2e): Playwright 烟囱
- **E00** chore(guard): .claude/settings.json + scripts/validate-mcp-write.sh + CI + Husky

⸻

## 7. 本地运行（复核）

```bash
pnpm i
cp .env.example .env    # 填 LiveKit / Podcastfy / OpenAI
pnpm dev                # 前后端一起起
pnpm typecheck && pnpm lint && pnpm test
# 可选
pnpm test:e2e
```

⸻

## 8. 风险与兜底
- **Podcastfy 返回 URL**：适配器先判 Content-Type，若 JSON 返回下载 URL，再二次拉取保存。
- **voice-mode 未安装/无 PATH**：/api/voice/start 返回 500 + 提示安装命令；UI 显示可读报错。
- **浏览器音频容器差异**：优先 audio/webm；Safari 用 audio/mp4，后端允许白名单并转发。
- **成本控制**：默认 Whisper 或自托管优先；需要自然音色再启用更贵 TTS。
- **安全**：validate-mcp-write.sh 禁写 .env/.git；阻止仓库外写入；multer 限制上传 ≤ 20MB。

⸻

## 9. 给 Claude Code 的执行顺序（一句话版）

1）落 000 初始化与 .env.example；
2）A：按测试驱动实现 /api/podcast + UI；
3）B：按测试驱动实现 voice（spawn + token + UI）；
4）C：按测试驱动实现 dictation provider 切换；
5）E：写入 .claude/settings.json、scripts/validate-mcp-write.sh、Husky 与 CI；
6）D：补 1 条 E2E；
7）确保 pre-commit/CI 全绿，开 PR。

⸻