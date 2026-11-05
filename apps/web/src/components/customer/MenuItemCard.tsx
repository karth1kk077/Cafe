import { formatMoney, type PublicMenuItem } from "../../lib/api";

/**
 * One menu row. Items with no choices add in a single tap; items with sizes or
 * add-ons open the item sheet so the customer can pick before adding.
 */
export function MenuItemCard({
  item,
  onAdd,
  onCustomize,
}: {
  item: PublicMenuItem;
  onAdd: (item: PublicMenuItem) => void;
  onCustomize: (item: PublicMenuItem) => void;
}) {
  const hasChoices = item.variants.length > 0 || item.addons.length > 0;
  const available = item.isAvailable !== false;

  return (
    <article className={`card flex gap-3 p-3 ${available ? "" : "opacity-60"}`}>
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-control bg-cream">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span aria-hidden className="text-2xl">☕</span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 font-semibold leading-snug">{item.name}</h3>
          <div className="num shrink-0 font-bold">{formatMoney(item.priceMinor)}</div>
        </div>

        {item.description && <p className="mt-0.5 text-sm leading-snug text-muted">{item.description}</p>}

        {(item.dietaryTags.length > 0 || item.allergens.length > 0) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.dietaryTags.map((tag) => (
              <span key={tag} className="badge bg-forest-soft text-forest">
                {tag}
              </span>
            ))}
            {item.allergens.length > 0 && (
              <span className="badge bg-amber-soft text-amber-ink">contains {item.allergens.join(", ")}</span>
            )}
          </div>
        )}

        <div className="mt-2">
          {!available ? (
            <span className="badge bg-cream text-muted">Sold out</span>
          ) : (
            <button
              type="button"
              className={`btn ${hasChoices ? "btn-ghost" : "btn-accent"} btn-sm`}
              aria-label={hasChoices ? `Choose options for ${item.name}` : `Add ${item.name} to order`}
              onClick={() => (hasChoices ? onCustomize(item) : onAdd(item))}
            >
              {hasChoices ? "Choose options" : "Add"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
