// Data masking: hides personal data in the results grid (display only; exports and copies are unchanged
// unless masked there too). Columns are picked by name, and values by shape (emails, card numbers).

let enabled = false
export const setMasking = (on: boolean) => { enabled = on }
export const maskingOn = () => enabled

const SENSITIVE = /(e-?mail|phone|mobile|tel(ephone)?|ssn|social|passport|card|iban|account_?n|password|passwd|secret|token|address|street|postcode|zip|birth|dob|national_?id|tax_?id)/i
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const CARD = /^(?:\d[ -]?){13,19}$/

function hide(t: string) {
  if (EMAIL.test(t)) { const [u, d] = t.split('@'); return `${u[0]}•••@${d}` }
  const digits = t.replace(/\D/g, '')
  if (digits.length >= 6 && digits.length >= t.length * 0.6) return '•••• ' + digits.slice(-4)
  return t.length <= 2 ? '••' : t[0] + '•'.repeat(Math.min(8, t.length - 1))
}

/** The text to show for a cell */
export function maskCell(column: string, text: string): string {
  if (!enabled || text === 'NULL' || !text) return text
  if (SENSITIVE.test(column) || EMAIL.test(text) || CARD.test(text)) return hide(text)
  return text
}
