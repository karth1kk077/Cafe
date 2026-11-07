import { formatMoney, type PublicMenuItem } from "../../lib/api";
import { AlertIcon, ChevronRightIcon, CoffeeIcon, LeafIcon, PlusIcon } from "../ui/Icon";

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
    <article className={`card flex gap-3 p-3 ${available ? "" : "opacity-70"}`}>
      <div className="relative flex h-[5.5rem] w-[5.5rem] shrink-0 items-center justify-center overflow-hidden rounded-control border border-line/70 bg-gradient-to-br from-cream-deep to-sand">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <CoffeeIcon size={30} className="text-copper/55" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 font-semibold leading-snug">{item.name}</h3>
          <div className="num shrink-0 font-bold text-espresso">{formatMoney(item.priceMinor)}</div>
        </div>

        {item.description && <p className="mt-0.5 text-sm leading-snug text-muted">{item.description}</p>}

        {(item.dietaryTags.length > 0 || item.allergens.length > 0) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.dietaryTags.map((tag) => (
              <span key={tag} className="badge badge-plain bg-forest-soft text-forest">
                <LeafIcon size={11} />
                {tag}
              </span>
            ))}
            {item.allergens.length > 0 && (
              <span className="badge badge-plain bg-amber-soft text-amber-ink">
                <AlertIcon size={11} />
                contains {item.allergens.join(", ")}
              </span>
            )}
          </div>
        )}

        <div className="mt-2">
          {!available ? (
            <span className="badge badge-plain bg-cream text-muted">Sold out</span>
          ) : (
            <button
              type="button"
              className={`btn ${hasChoices ? "btn-ghost" : "btn-accent"} btn-sm`}
              aria-label={hasChoices ? `Choose options for ${item.name}` : `Add ${item.name} to order`}
              onClick={() => (hasChoices ? onCustomize(item) : onAdd(item))}
            >
              {hasChoices ? (
                <>
                  Choose options
                  <ChevronRightIcon size={14} />
                </>
              ) : (
                <>
                  <PlusIcon size={14} />
                  Add
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
