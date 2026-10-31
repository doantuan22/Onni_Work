import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { I18nProvider, useI18n } from './provider'

function Probe() {
  const { language, setLanguage, t, tn } = useI18n()
  return (
    <div>
      <p data-testid="language">{language}</p>
      <p data-testid="text">{t('Language')}</p>
      <p data-testid="plural">{tn(1, '{count} task', '{count} tasks')}</p>
      <p data-testid="many">{tn(3, '{count} task', '{count} tasks')}</p>
      <button type="button" onClick={() => setLanguage('vi')}>Vietnamese</button>
      <button type="button" onClick={() => setLanguage('en')}>English</button>
    </div>
  )
}

describe('I18nProvider', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    document.documentElement.lang = 'en'
  })

  it('stays English without a provider, so existing component tests keep their wording', () => {
    render(<Probe />)
    expect(screen.getByTestId('language').textContent).toBe('en')
    expect(screen.getByTestId('text').textContent).toBe('Language')
    expect(screen.getByTestId('plural').textContent).toBe('1 task')
    expect(screen.getByTestId('many').textContent).toBe('3 tasks')
  })

  it('switches to Vietnamese, persists the choice and marks the document', async () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByTestId('text').textContent).toBe('Language')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Vietnamese' }))
    })

    expect(screen.getByTestId('language').textContent).toBe('vi')
    expect(screen.getByTestId('text').textContent).toBe('Ngôn ngữ')
    expect(localStorage.getItem('onni-language')).toBe('vi')
    expect(document.documentElement.lang).toBe('vi')
  })

  it('reads a stored choice on first paint', () => {
    localStorage.setItem('onni-language', 'vi')
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByTestId('language').textContent).toBe('vi')
    expect(document.documentElement.lang).toBe('vi')
  })
})
