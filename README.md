# dsh-voice-cues-friday

回合结束、请求授权、智能体提问时，各放一段短语音提示。**默认使用「星期五」语音包**（星期五任务完成 / 星期五需要你的授权 / 星期五有问题需要你回答）；同一份包里另带通用台词，配置一行即可切换。

由宿主进程播放——页面关掉、窗口最小化、切到别的 App 都照常响。macOS / Windows / Linux 一个包搞定，不需要装额外播放器。

> 这是 `dsh-voice-cues` 的「星期五」版；不含星期五语音的通用版本是另一个仓库。

| 时机 | DSH 事件 | 提示音 |
|---|---|---|
| 一轮对话结束 | `turn/end`（默认只认 `completed`） | `done` |
| 智能体请求授权 | `approval/asked` | `approval` |
| 智能体向你提问 | `tool/call`，工具名 `ask_user_question` | `question` |

只有**主会话**的回合结束才会播“任务完成”；子代理会话（`origin: subagent` 或 `delegationDepth > 0`）整类静音——完成、授权、提问都不出声。需要时可用 `includeSubagents: true` 打开。

## 安装

```sh
dsh plugin --profile <你的 profile> add dsh-voice-cues-friday
# 或直接从 GitHub：
dsh plugin --profile <你的 profile> add github:wangfujian762/dsh-voice-cues-friday
```

本地目录也可以（绝对路径，装成链接）。装完重启一次 DSH。

## 平台

| 平台 | 播放器 | 文件 |
|---|---|---|
| macOS | `afplay`（系统自带） | `audio/**/*.mp3` |
| Windows | PowerShell + `System.Media.SoundPlayer`（系统自带） | `audio/**/*.wav` |
| Linux | `paplay` → `ffplay` → `aplay`（依次回退） | mp3 / wav |

Windows 走 `-EncodedCommand`（UTF-16LE base64）调用，路径里有空格、引号、中文都不会出问题；`spawn` 带 `windowsHide`，不闪控制台窗口。PowerShell 启动有 0.3–0.8 秒延迟，属正常。

## 配置

在你自己 profile 的 `cordis.patch.yml` 里加一条同 id 覆盖（整体替换，只写要改的键）：

```yaml
- id: voice-cues
  config:
    variant: 'default'   # 换成通用台词；默认是 'friday'
    onQuestion: false
    volume: 0.8
```

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `onTurnEnd` | `true` | 回合结束提示音 |
| `onApproval` | `true` | 请求授权提示音 |
| `onQuestion` | `true` | 提问提示音 |
| `turnEndReasons` | `['completed']` | 哪些 `turn/end` 原因会响，可加 `error` / `aborted` / `max-tokens` |
| `includeSubagents` | `false` | 子代理会话是否也响 |
| `variant` | `'friday'` | `friday` 星期五语音 / `default` 通用台词 |
| `volume` | `1` | 0–4，1 为原音量（Windows/Linux 映射到百分比） |
| `minIntervalMs` | `600` | 同类提示音最小间隔 |
| `audio.done` / `audio.approval` / `audio.question` | `''` | 换成自己的音频，填绝对路径 |

## 换台词 / 换音色

直接覆盖对应目录下的同名文件即可（本地链接安装时立刻生效）：

- 星期五版：`audio/friday/`；通用版：`audio/`
- macOS / Linux 读 `.mp3`，Windows 读 `.wav`，两处都要换

原素材是 Edge TTS 的 `zh-CN-XiaoxiaoNeural`（24 kHz / 48 kbps 单声道）。离线重做：

```sh
say -v Tingting "星期五任务完成" -o /tmp/done.aiff
ffmpeg -y -i /tmp/done.aiff -codec:a libmp3lame -b:a 48k audio/friday/done.mp3
ffmpeg -y -i audio/friday/done.mp3 -ar 24000 -ac 1 -c:a pcm_s16le audio/friday/done.wav
```

## 开发

```sh
npm test        # 30 个单元测试，不发声，三平台通用
npm run check   # 语法 + 测试
```

## 隐私

不联网、不合成、不上报。只读会话事件里的类型与原因，音频是包内文件。

## 许可

MIT
