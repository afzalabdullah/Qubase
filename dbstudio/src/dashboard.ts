// Dashboard tiles: saved queries with a chart setup, kept per connection.
import { createContext } from 'react'

export interface ChartCfg { kind: 'bar' | 'line' | 'pie'; x: string; ys: string[] }
export interface Tile { id: string; title: string; sql: string; chart: ChartCfg; wide?: boolean }

const key = (connId: string) => `dashboard:${connId}`
export const DASH_EVENT = 'qubase:dashboard'

export function readTiles(connId: string): Tile[] {
  try { return JSON.parse(localStorage.getItem(key(connId)) ?? '[]') } catch { return [] }
}
export function writeTiles(connId: string, tiles: Tile[]) {
  try { localStorage.setItem(key(connId), JSON.stringify(tiles)) } catch { /* full */ }
  window.dispatchEvent(new Event(DASH_EVENT))
}
export function addTile(connId: string, t: Omit<Tile, 'id'>) {
  writeTiles(connId, [...readTiles(connId), { ...t, id: crypto.randomUUID() }])
}

/** Set by the query tab around its results, so a chart there can be pinned with its SQL */
export const PinContext = createContext<((chart: ChartCfg) => void) | null>(null)
