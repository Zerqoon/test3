import { BigGamesClient } from '../api/BigGamesClient.js';

export interface RapVariant {
  label: string;
  value: number;
  delta: number;
  deltaPct: number;
}

export interface RapResult {
  name: string;
  imageUrl: string | null;
  baselineLabel: string;
  variants: RapVariant[];
}

type RapRow = { category: string; configData: Record<string, any>; value: number };
type PetRow = {
  configName: string;
  category?: string;
  configData: { name?: string; thumbnail?: string; goldenThumbnail?: string; [key: string]: any };
};

export class RapService {
  constructor(private big: BigGamesClient) {}

  async find(query: string): Promise<RapResult> {
    const [rap, pets] = await Promise.all([this.big.rap(), this.big.pets()]);
    const rapRows = rap.data as RapRow[];
    const petRows = pets.data as PetRow[];
    const normalized = query.trim().toLowerCase();

    const exact = rapRows.filter(row =>
      String(row.configData.id ?? '').toLowerCase() === normalized &&
      row.category.toLowerCase() === 'pet'
    );
    const rows = exact.length
      ? exact
      : rapRows.filter(row =>
          String(row.configData.id ?? '').toLowerCase().includes(normalized) &&
          row.category.toLowerCase() === 'pet'
        );

    if (!rows.length) throw new Error('Pet/item not found in RAP');

    const canonical = String(rows[0]!.configData.id);
    const same = rows.filter(row => String(row.configData.id) === canonical);
    const label = (row: RapRow) =>
      `${row.configData.sh ? 'Shiny ' : ''}${row.configData.pt === 1 ? 'Golden ' : row.configData.pt === 2 ? 'Rainbow ' : ''}${canonical}`.trim();

    // Prefer Regular as baseline. If BIG Games temporarily omits it, use the first
    // available variant as an explicit baseline so the display remains stable (+0),
    // rather than inventing an unknown numeric difference.
    const baselineRow = same.find(row => row.configData.pt == null && !row.configData.sh) ?? same[0]!;
    const baselineValue = baselineRow.value;
    const baselineLabel = label(baselineRow);

    const variants = same
      .map(row => {
        const delta = row.value - baselineValue;
        return {
          label: label(row),
          value: row.value,
          delta,
          deltaPct: baselineValue === 0 ? 0 : (delta / baselineValue) * 100
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    const pet = petRows.find(row =>
      row.configName.toLowerCase() === canonical.toLowerCase() ||
      row.configData.name?.toLowerCase() === canonical.toLowerCase()
    );
    const asset = pet?.configData.thumbnail?.match(/\d+/)?.[0] ?? null;

    return {
      name: canonical,
      imageUrl: asset ? `https://ps99.biggamesapi.io/image/${asset}` : null,
      baselineLabel,
      variants
    };
  }
}
