'use client'

import { useActionState } from 'react'
import { Button, Input } from '@/components/ui'
import type { AppSetting } from '@/lib/types'
import { saveSetting, type ActionResult } from './actions'

function SettingRow({ setting }: { setting: AppSetting }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    saveSetting,
    null,
  )

  const serialised =
    typeof setting.value === 'string' ? setting.value : JSON.stringify(setting.value)

  return (
    <li className="px-4 py-3.5 hover:bg-surface-sunken/40">
      <form action={formAction} className="flex flex-wrap items-start gap-3">
        <input type="hidden" name="key" value={setting.key} />

        <div className="min-w-0 flex-1">
          <label htmlFor={`setting-${setting.key}`} className="font-mono text-[13px] font-semibold text-ink">
            {setting.key}
          </label>
          <p className="mt-0.5 text-[13px] text-ink-muted">{setting.description}</p>
        </div>

        <div className="flex items-center gap-2">
          <Input
            id={`setting-${setting.key}`}
            name="value"
            defaultValue={serialised}
            className="w-64 max-w-full font-mono text-[13px] sm:w-72"
          />
          <Button type="submit" disabled={pending}>
            {pending ? '…' : 'Save'}
          </Button>
        </div>
      </form>

      {state?.error && <p className="mt-1.5 text-[12px] text-critical">{state.error}</p>}
      {state?.ok && <p className="mt-1.5 text-[12px] text-done">Saved</p>}
    </li>
  )
}

export function ConfigPanel({ settings }: { settings: AppSetting[] }) {
  return (
    <div>
      <div className="border-b px-4 py-3">
        <p className="text-[14px] font-semibold text-ink">Configuration</p>
        <p className="text-[12px] text-ink-muted">
          Every threshold the app reasons with lives here. Values are JSON: numbers plain, lists as{' '}
          <span className="font-mono">[&quot;USD&quot;,&quot;EUR&quot;]</span>.
        </p>
      </div>

      {settings.length === 0 ? (
        <p className="px-4 py-8 text-center text-[14px] text-ink-muted">No settings recorded.</p>
      ) : (
        <ul className="divide-y">
          {settings.map((setting) => (
            <SettingRow key={setting.key} setting={setting} />
          ))}
        </ul>
      )}
    </div>
  )
}
