/** The AI panel fixing a broken join. Drawn in the app's dark UI. */
export function AiChat() {
  return (
    <div className="overflow-hidden rounded-[14px] border border-[#3a3f48] bg-[#16181d] text-left text-sm text-[#c9ccd2] shadow-[0_30px_80px_-30px_rgba(16,18,22,.55)]">
      <div className="flex items-center justify-between border-b border-[#2c3038] bg-[#1d2026] px-4 py-2.5 text-xs">
        <span className="font-semibold text-[#eceef1]">AI assistant</span>
        <span className="text-[#6b7079]">History</span>
      </div>
      <div className="space-y-4 p-5">
        <p className="text-xs text-[#8b9099]">Sharing: orders.sql, line 3, the last error, schema</p>
        <div className="ml-auto w-fit max-w-[85%] rounded-xl rounded-br-sm bg-[#ee5a0a] px-4 py-2.5 font-medium text-white">Why does line 3 fail? Fix it.</div>
        <div className="max-w-[94%] rounded-xl rounded-bl-sm bg-[#ffffff0d] px-4 py-3">
          <p>There is no table called <code className="font-mono text-[#ff9a52]">customer</code>. Your schema has <code className="font-mono text-[#ff9a52]">customers</code>, and the join should use <code className="font-mono">customer_id</code>.</p>
          <div className="mt-3 overflow-hidden rounded-lg border border-[#2c3038] font-mono text-xs">
            <div className="bg-rose-500/10 px-3 py-1.5 text-rose-300"><span aria-hidden="true">− </span>JOIN customer c ON c.id = o.id</div>
            <div className="bg-emerald-500/10 px-3 py-1.5 text-emerald-300"><span aria-hidden="true">+ </span>JOIN customers c ON c.id = o.customer_id</div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-md bg-[#ee5a0a] px-3 py-1 text-white">Replace query</span>
            <span className="rounded-md border border-[#3a3f48] px-3 py-1 text-[#eceef1]">Insert at cursor</span>
            <span className="rounded-md border border-[#3a3f48] px-3 py-1 text-[#eceef1]">Run</span>
          </div>
        </div>
        <p className="text-xs text-emerald-400">Ran: 250 rows in 41 ms</p>
      </div>
    </div>
  )
}
