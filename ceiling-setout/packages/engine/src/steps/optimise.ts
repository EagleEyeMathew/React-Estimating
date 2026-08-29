import { quantise } from '@ceiling/geometry';
import type { RulePack } from '@ceiling/rules';
import type { Member } from '../types.js';

export interface CutPiece {
  readonly memberId: string;
  readonly length: number;
}

export interface StockBar {
  readonly stockLength: number;
  readonly pieces: readonly CutPiece[];
  readonly used: number;
  readonly offcut: number;
  /** True when the offcut is long enough to go back in the rack. */
  readonly offcutReusable: boolean;
}

export interface ProductNesting {
  readonly productCode: string;
  readonly description: string;
  readonly bars: readonly StockBar[];
  readonly barCount: number;
  readonly totalStock: number;
  readonly totalCut: number;
  readonly waste: number;
  readonly wastePercent: number;
  readonly packQuantity: number | null;
  readonly packsRequired: number | null;
  /** Pieces longer than the longest stock length, which have to be joined. */
  readonly oversize: readonly CutPiece[];
}

export interface Nesting {
  readonly products: readonly ProductNesting[];
  readonly totalWaste: number;
}

/**
 * Step 12. Nest cut lengths into stock lengths.
 *
 * First-fit-decreasing on the longest stock length available. It is not optimal - bin
 * packing is not - but it is deterministic, quick, and within a few percent of
 * optimal on the length distributions a ceiling produces, where most pieces are
 * either full-room runs or short infills.
 */
export function nestCuts(members: readonly Member[], pack: RulePack): Nesting {
  const byProduct = new Map<string, Member[]>();
  for (const m of members) {
    // Point members are counted, not cut.
    if (m.planLength === 0 && m.type !== 'hanger') continue;
    const code = m.productCode ?? '(no product selected)';
    const list = byProduct.get(code) ?? [];
    list.push(m);
    byProduct.set(code, list);
  }

  const kerf = pack.optimisation.kerf ?? 0;
  const minOffcut = pack.optimisation.minReusableOffcut;
  const products: ProductNesting[] = [];

  for (const [code, list] of [...byProduct.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const product = pack.catalogue.find((p) => p.code === code) ?? null;
    const stockLengths = (product?.stockLengths ?? pack.optimisation.stockLengths ?? []).filter((l) => l > 0);
    const pieces: CutPiece[] = list
      .map((m) => ({ memberId: m.id, length: m.length }))
      .sort((a, b) => b.length - a.length || a.memberId.localeCompare(b.memberId));

    if (stockLengths.length === 0) {
      products.push({
        productCode: code,
        description: product?.description ?? 'stock lengths not entered',
        bars: [],
        barCount: 0,
        totalStock: 0,
        totalCut: quantise(pieces.reduce((s, p) => s + p.length, 0)),
        waste: 0,
        wastePercent: 0,
        packQuantity: product?.packQuantity ?? null,
        packsRequired: null,
        oversize: [],
      });
      continue;
    }

    const longest = Math.max(...stockLengths);
    const oversize = pieces.filter((p) => p.length > longest + 1e-6);
    const nestable = pieces.filter((p) => p.length <= longest + 1e-6);

    const bars: { stockLength: number; pieces: CutPiece[]; used: number }[] = [];
    for (const piece of nestable) {
      let placed = false;
      for (const bar of bars) {
        const need = piece.length + (bar.pieces.length > 0 ? kerf : 0);
        if (bar.used + need <= bar.stockLength + 1e-6) {
          bar.pieces.push(piece);
          bar.used = quantise(bar.used + need);
          placed = true;
          break;
        }
      }
      if (!placed) {
        // Shortest stock length that fits the piece, so a 900mm infill does not open
        // a 6m bar when a 3.6m one would do.
        const stock = [...stockLengths].sort((a, b) => a - b).find((l) => l + 1e-6 >= piece.length) ?? longest;
        bars.push({ stockLength: stock, pieces: [piece], used: quantise(piece.length) });
      }
    }

    const finished: StockBar[] = bars.map((b) => {
      const offcut = quantise(b.stockLength - b.used);
      return {
        stockLength: b.stockLength,
        pieces: b.pieces,
        used: b.used,
        offcut,
        offcutReusable: minOffcut !== null && offcut >= minOffcut,
      };
    });

    const totalStock = quantise(finished.reduce((s, b) => s + b.stockLength, 0));
    const totalCut = quantise(nestable.reduce((s, p) => s + p.length, 0));
    const waste = quantise(finished.filter((b) => !b.offcutReusable).reduce((s, b) => s + b.offcut, 0));

    products.push({
      productCode: code,
      description: product?.description ?? '',
      bars: finished,
      barCount: finished.length,
      totalStock,
      totalCut,
      waste,
      wastePercent: totalStock > 0 ? quantise((waste / totalStock) * 100) : 0,
      packQuantity: product?.packQuantity ?? null,
      packsRequired: product?.packQuantity ? Math.ceil(finished.length / product.packQuantity) : null,
      oversize,
    });
  }

  return { products, totalWaste: quantise(products.reduce((s, p) => s + p.waste, 0)) };
}
