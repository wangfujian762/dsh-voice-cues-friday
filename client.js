window.__ModuleLoader__.load({
  id: 'dsh-voice-cues-friday',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Settings namespace: the loader entry id. */
    const NS = 'voice-cues'

    const VARIANTS = [
      ['friday-dongbei', '东北话 · 星期五（默认）'],
      ['friday', '普通话 · 星期五'],
      ['personal-dongbei', '东北话 · 小鲸鱼'],
      ['personal', '普通话 · 小鲸鱼'],
      ['dongbei', '东北话 · 通用'],
      ['default', '普通话 · 通用'],
    ]

    const PREVIEWS = [['done', '完成'], ['approval', '授权'], ['question', '选择']]

    const TOGGLES = [
      ['onTurnEnd', '本轮结束', '主会话这一轮跑完时响'],
      ['onApproval', '需要授权', '智能体请求授权时响'],
      ['onQuestion', '需要选择', '智能体提问、等你回答时响'],
      ['includeSubagents', '子代理也响', '默认关：子代理结束得太频繁'],
    ]

    const colors = {
      label: 'var(--dsw-alias-label-primary)',
      secondary: 'var(--dsw-alias-label-secondary)',
      tertiary: 'var(--dsw-alias-label-tertiary)',
      border: 'var(--dsw-alias-border-l2)',
      error: 'var(--dsw-alias-state-error-primary)',
      bg: 'var(--dsw-alias-bg-layer-2)',
    }

    const styles = {
      root: { display: 'flex', flexDirection: 'column', gap: 14, color: colors.label, fontSize: 13 },
      head: { display: 'flex', alignItems: 'baseline', gap: 8 },
      title: { margin: 0, fontSize: 14, fontWeight: 600, color: colors.label },
      subtitle: { margin: 0, color: colors.tertiary, fontSize: 12 },
      row: { display: 'flex', alignItems: 'center', gap: 12, minHeight: 32 },
      rowText: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 },
      rowLabel: { color: colors.label },
      rowHint: { color: colors.tertiary, fontSize: 11 },
      control: { flex: 'none', display: 'flex', alignItems: 'center', gap: 8 },
      select: {
        minWidth: 190, padding: '5px 8px', borderRadius: 6, fontSize: 13,
        color: colors.label, background: colors.bg, border: '1px solid ' + colors.border,
      },
      range: { width: 160 },
      value: { color: colors.secondary, fontSize: 12, minWidth: 42, textAlign: 'right' },
      error: { color: colors.error, fontSize: 12, margin: 0 },
      buttons: { display: 'flex', gap: 6 },
      button: {
        padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
        color: colors.label, background: colors.bg, border: '1px solid ' + colors.border,
      },
      buttonBusy: { opacity: 0.65, cursor: 'progress' },
    }

    /** Subscribe to a config form and return its latest snapshot. */
    function useForm(form) {
      const [snap, setSnap] = React.useState(form.getSnapshot())
      React.useEffect(() => form.subscribe(() => setSnap(form.getSnapshot())), [form])
      return snap
    }

    function Row({ label, hint, children }) {
      return h('div', { style: styles.row },
        h('div', { style: styles.rowText },
          h('span', { style: styles.rowLabel }, label),
          hint ? h('span', { style: styles.rowHint }, hint) : null),
        h('div', { style: styles.control }, children))
    }

    function VoiceCuesCard({ form }) {
      const snap = useForm(form)
      const [error, setError] = React.useState('')
      const value = snap.status === 'ready' ? snap.value : {}
      const writable = snap.status === 'ready' && snap.writable !== false

      const write = (key, next) => {
        setError('')
        Promise.resolve(form.set(key, next)).catch(reason => {
          setError('保存失败：' + String((reason && reason.message) || reason))
        })
      }

      const variant = String(value.variant || 'friday-dongbei')
      const volume = typeof value.volume === 'number' ? value.volume : 1

      const [previewing, setPreviewing] = React.useState('')
      if (snap.status !== 'ready') {
        return h('div', { style: styles.root }, h('p', { style: styles.subtitle }, '正在读取设置…'))
      }

      const preview = kind => {
        if (previewing) return
        setError('')
        setPreviewing(kind)
        fetch('/voice-cues/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variant, kind }),
        }).then(response => {
          if (!response.ok) throw new Error('HTTP ' + response.status)
        }).catch(reason => {
          setError('试听失败：' + String((reason && reason.message) || reason))
        }).finally(() => {
          setTimeout(() => setPreviewing(''), 600)
        })
      }

      return h('div', { style: styles.root },
        h('div', { style: styles.head },
          h('h3', { style: styles.title }, '语音提示音'),
          h('span', { style: styles.subtitle }, writable ? '改动立即生效' : '当前不可编辑')),
        h(Row, { label: '语音风格', hint: '选一套随包录音' },
          h('select', {
            style: styles.select,
            value: variant,
            disabled: !writable,
            onChange: event => write('variant', event.target.value),
          }, VARIANTS.map(([id, name]) => h('option', { key: id, value: id }, name)))),
        h(Row, { label: '试听', hint: '用当前选择的风格播放' },
          h('div', { style: styles.buttons }, PREVIEWS.map(([kind, label]) =>
            h('button', {
              key: kind,
              type: 'button',
              style: previewing === kind ? { ...styles.button, ...styles.buttonBusy } : styles.button,
              disabled: previewing !== '',
              onClick: () => preview(kind),
            }, previewing === kind ? '播放中…' : label)))),
        TOGGLES.map(([key, label, hint]) => h(Row, { key, label, hint },
          h('input', {
            type: 'checkbox',
            checked: value[key] === true,
            disabled: !writable,
            onChange: event => write(key, event.target.checked),
          }))),
        h(Row, { label: '音量', hint: '1.0 = 原音量' },
          h('input', {
            type: 'range', min: 0, max: 2, step: 0.05,
            style: styles.range,
            value: volume,
            disabled: !writable,
            onChange: event => write('volume', Number(event.target.value)),
          }),
          h('span', { style: styles.value }, Math.round(volume * 100) + '%')),
        error ? h('p', { style: styles.error }, error) : null)
    }

    return {
      inject: ['slots', 'configForms'],
      apply(ctx) {
        const form = ctx.configForms.get(NS)
        if (!form) return
        ctx.effect(() => ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item',
          id: NS,
          order: 96,
          inject: () => ({ form }),
        }, VoiceCuesCard)), 'voice-cues: settings card')
      },
    }
  },
})
