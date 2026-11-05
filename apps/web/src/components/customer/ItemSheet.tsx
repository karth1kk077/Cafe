import { useMemo, useState } from "react";
import { formatMoney, type PublicMenuItem } from "../../lib/api";
import { haptic } from "../../lib/haptics";
import type { StoredCartLine } from "../../lib/session";
import { BottomSheet } from "./BottomSheet";

/**
 * Size / add-on / note picker. Owns only the draft; the page owns the cart.
 * Mount with a `key` per item so opening a different dish starts clean.
 */
export function ItemSheet({
  item,
  open,
  onClose,
  onAdd,
}: {
  item: PublicMenuItem | null;
  open: boolean;
  onClose: () => void;
  onAdd: (line: StoredCartLine) => void;
}) {
  const [variantId, setVariantId] = useState<string | undefined>(() => item?.variants[0]?.id);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  const variant = item?.variants.find((option) => option.id === variantId);
  const addons = useMemo(() => item?.addons.filter((addon) => addonIds.includes(addon.id)) ?? [], [item, addonIds]);
  const unitPriceMinor = (item?.priceMinor ?? 0) + (variant?.priceDeltaMinor ?? 0) + addons.reduce((sum, addon) => sum + addon.priceMinor, 0);

  if (!item) return null;

  function add() {
    if (!item) return;
    const key = [item.id, variantId ?? "", [...addonIds].sort().join(","), notes.trim()].join("|");
    haptic();
    onAdd({
      key,
      menuItemId: item.id,
      name: item.name,
      variantId,
      variantName: variant?.name,
      addonIds: addons.map((addon) => addon.id),
      addonNames: addons.map((addon) => addon.name),
      unitPriceMinor,
      quantity,
      specialInstructions: notes.trim() || undefined,
    });
    onClose();
  }

  function toggleAddon(id: string) {
    haptic(8);
    setAddonIds((previous) => (previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]));
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={item.name}
      footer={
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-control border border-line p-1">
            <button
              type="button"
              className="btn btn-ghost !min-h-10 !border-0 !px-3"
              aria-label="Decrease quantity"
              onClick={() => {
                haptic(8);
                setQuantity((value) => Math.max(1, value - 1));
              }}
            >
              −
            </button>
            <span className="num min-w-6 text-center font-bold">{quantity}</span>
            <button
              type="button"
              className="btn btn-ghost !min-h-10 !border-0 !px-3"
              aria-label="Increase quantity"
              onClick={() => {
                haptic(8);
                setQuantity((value) => value + 1);
              }}
            >
              +
            </button>
          </div>
          <button type="button" className="btn btn-accent flex-1" onClick={add}>
            Add · <span className="num">{formatMoney(unitPriceMinor * quantity)}</span>
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm leading-snug text-muted">{item.description ?? "Made fresh in our kitchen."}</p>
          <span className="num shrink-0 font-bold">{formatMoney(item.priceMinor)}</span>
        </div>

        {item.variants.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Choose a size</legend>
            <div className="flex flex-wrap gap-2">
              {item.variants.map((option) => {
                const selected = option.id === variantId;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selected}
                    className={`chip ${selected ? "!bg-espresso text-white" : "bg-cream text-espresso"}`}
                    onClick={() => {
                      haptic(8);
                      setVariantId(option.id);
                    }}
                  >
                    {option.name}
                    {option.priceDeltaMinor !== 0 && (
                      <span className="num ml-1 font-normal">
                        {option.priceDeltaMinor > 0 ? "+" : "−"}
                        {formatMoney(Math.abs(option.priceDeltaMinor))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        {item.addons.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">
              Add-ons <span className="font-normal text-muted">(optional)</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {item.addons.map((addon) => {
                const selected = addonIds.includes(addon.id);
                return (
                  <button
                    key={addon.id}
                    type="button"
                    aria-pressed={selected}
                    className={`chip ${selected ? "!bg-espresso text-white" : "bg-cream text-espresso"}`}
                    onClick={() => toggleAddon(addon.id)}
                  >
                    {addon.name}
                    <span className="num ml-1 font-normal">+{formatMoney(addon.priceMinor)}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        <div>
          <label className="mb-2 block text-sm font-semibold" htmlFor="item-notes">
            Special instructions <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="item-notes"
            className="input"
            maxLength={200}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="e.g. less sugar, no onions"
          />
        </div>
      </div>
    </BottomSheet>
  );
}
