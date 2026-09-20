/**
 * The canvas row's right-click actions (F1.8) — the two decisions behind them.
 *
 * The components are view; what can drift silently and break the menu is where it
 * lands (a menu that opens half off-screen looks like the feature is missing) and
 * which application id opens the folder (the host filters its catalog by platform,
 * so a wrong pick here is a button that reports "unknown app" instead of opening
 * anything).
 */
import { describe, expect, it } from 'vitest'
import { FILE_MANAGER_APPS, fileManagerOf, placeMenu } from '../src/client/canvas-menu.tsx'

describe('file manager selection', () => {
  it('picks the file manager a host actually reports', () => {
    expect(fileManagerOf(['finder', 'vscode', 'iterm'])).toBe('finder')
    expect(fileManagerOf(['explorer', 'cursor'])).toBe('explorer')
    expect(fileManagerOf(['filemanager'])).toBe('filemanager')
  })

  it('does not care where in the list it sits', () => {
    expect(fileManagerOf(['terminal', 'iterm', 'finders', 'finder'])).toBe('finder')
  })

  it('is empty when the deployment has no file manager at all', () => {
    expect(fileManagerOf([])).toBe('')
    expect(fileManagerOf(['vscode', 'xcode'])).toBe('')
  })

  it('never mistakes a code editor for the file manager', () => {
    for (const id of ['vscode', 'cursor', 'zed', 'sublimetext', 'androidstudio']) {
      expect(fileManagerOf([id])).toBe('')
    }
  })

  it('offers exactly the platform file managers, file manager first', () => {
    // The host already filtered by platform, so at most one is ever present; the
    // order is what makes a host that reports several (a future one) deterministic.
    expect(FILE_MANAGER_APPS).toEqual(['finder', 'explorer', 'filemanager'])
    expect(fileManagerOf(['filemanager', 'explorer', 'finder'])).toBe('finder')
  })
})

describe('context menu placement', () => {
  const viewport = [1440, 900] as const

  it('sits exactly on the pointer when there is room', () => {
    expect(placeMenu(300, 200, 200, 120, ...viewport)).toEqual({ left: 300, top: 200 })
  })

  it('pulls back so it fits at the right edge', () => {
    expect(placeMenu(1400, 200, 200, 120, ...viewport)).toEqual({ left: 1440 - 200 - 8, top: 200 })
  })

  it('pulls up so it fits at the bottom edge', () => {
    expect(placeMenu(300, 880, 200, 120, ...viewport)).toEqual({ left: 300, top: 900 - 120 - 8 })
  })

  it('keeps the margin when a menu is taller than the viewport', () => {
    // A cramped window must still show the menu's top — sliding to a negative
    // coordinate would put its first item above the screen, out of reach.
    expect(placeMenu(300, 400, 200, 1200, 1440, 600)).toEqual({ left: 300, top: 8 })
    expect(placeMenu(300, 400, 2000, 120, 1440, 900)).toEqual({ left: 8, top: 400 })
  })

  it('treats a pointer above or left of the margin as the margin', () => {
    expect(placeMenu(2, 3, 200, 120, ...viewport)).toEqual({ left: 8, top: 8 })
  })
})
