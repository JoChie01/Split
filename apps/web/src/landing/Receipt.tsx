/*
 * landing/Receipt.tsx
 *
 * WHAT: A small working receipt. Tap the items you ordered and your total updates.
 * LEARN FROM IT:
 *   - useState holds which items are claimed. Changing it redraws the component.
 *   - Money is in centavos (integers). formatPeso from @split/core turns them into pesos for display.
 */
import { useState } from "react";
import { formatPeso } from "@split/core";

const ITEMS = [
  { id: "sisig", name: "Sisig", priceCentavos: 28000 },
  { id: "pancit", name: "Pancit canton", priceCentavos: 18000 },
  { id: "sago", name: "Sago at gulaman", priceCentavos: 9500 },
];

export function Receipt() {
  const [claimed, setClaimed] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    // Build a new Set. React needs a new object to notice the change.
    setClaimed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const mine = ITEMS.filter((item) => claimed.has(item.id)).reduce((sum, item) => sum + item.priceCentavos, 0);

  return (
    <section className="receipt" aria-label="Try it: tap what you ordered">
      <div className="receipt-head">
        <span>Barkada dinner</span>
        <span>Oct 24</span>
      </div>
      <hr />
      {ITEMS.map((item) => {
        const isMine = claimed.has(item.id);
        return (
          <button
            key={item.id}
            type="button"
            className="line"
            aria-pressed={isMine}
            onClick={() => toggle(item.id)}
          >
            <span>{item.name}</span>
            <span className="line-right">
              <span className="tap">{isMine ? "mine" : "tap"}</span>
              <span className="price">{formatPeso(item.priceCentavos)}</span>
            </span>
          </button>
        );
      })}
      <hr />
      <div className="you-pay">
        <span className="label">Your share</span>
        <span className="amount">{formatPeso(mine)}</span>
      </div>
      <p className="hint">Tap the items you ordered. Your share updates as you go.</p>
    </section>
  );
}