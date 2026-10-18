import { post } from './api'

export interface ShareInfo { url: string; message: string; phone: string; customer_name: string; whatsapp_url: string }

/** Opened SYNCHRONOUSLY inside the click handler (before any await) so the browser's popup blocker allows it;
 *  its address is filled in once the server has the wa.me link ready. */
export function openPendingWindow(): Window | null {
  const w = window.open('', '_blank')
  if (w) {
    try {
      w.opener = null
      w.document.title = 'Opening WhatsApp…'
      w.document.body.style.cssText = 'font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#4b4870'
      w.document.body.textContent = 'Opening WhatsApp…'
    } catch { /* cross-origin once navigated - nothing to do */ }
  }
  return w
}

/** Asks the server for the wa.me link (addressed to the customer's phone, message + signed PDF link prefilled)
 *  and sends the pre-opened window there. Returns false if no window could be opened (popup blocked). */
export async function sendToWhatsApp(invoiceId: number, popup: Window | null): Promise<{ info: ShareInfo; opened: boolean }> {
  try {
    const info = await post<ShareInfo>(`/api/invoices/${invoiceId}/share/`)
    if (popup && !popup.closed) { popup.location.href = info.whatsapp_url; return { info, opened: true } }
    const w = window.open(info.whatsapp_url, '_blank')
    return { info, opened: !!w }
  } catch (e) {
    popup?.close()
    throw e
  }
}

export const sendToEmail = (invoiceId: number) => post<{ sent_to: string; detail: string }>(`/api/invoices/${invoiceId}/send-email/`)
