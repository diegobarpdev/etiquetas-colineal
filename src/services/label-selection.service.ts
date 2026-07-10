import { LabelData } from '../types';

export interface LabelSelection {
  groups?: string[];
  from?: number;
  to?: number;
  index?: number;
}

export function lineGroupId(lineIndex: number): string {
  return `L${lineIndex}`;
}

export function componentGroupId(lineIndex: number, internalRef: string): string {
  return `${lineGroupId(lineIndex)}:C${internalRef}`;
}

export function parseLabelSelection(query: Record<string, unknown>): LabelSelection {
  const selection: LabelSelection = {};

  const groupsRaw = query.groups;
  if (typeof groupsRaw === 'string' && groupsRaw.trim()) {
    selection.groups = groupsRaw
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);
  }

  const fromRaw = query.from;
  if (fromRaw !== undefined && fromRaw !== null && fromRaw !== '') {
    const from = parseInt(String(fromRaw), 10);
    if (!isNaN(from) && from >= 1) selection.from = from;
  }

  const toRaw = query.to;
  if (toRaw !== undefined && toRaw !== null && toRaw !== '') {
    const to = parseInt(String(toRaw), 10);
    if (!isNaN(to) && to >= 1) selection.to = to;
  }

  const indexRaw = query.index;
  if (indexRaw !== undefined && indexRaw !== null && indexRaw !== '') {
    const index = parseInt(String(indexRaw), 10);
    if (!isNaN(index) && index >= 0) selection.index = index;
  }

  return selection;
}

export function filterLabelsByGroups(
  labels: LabelData[],
  groupIds?: string[],
): LabelData[] {
  if (!groupIds?.length) return labels;

  const selected = new Set(groupIds);
  return labels.filter((label) =>
    label.selectionGroupIds.some((groupId) => selected.has(groupId)),
  );
}

export function applyRangeToLabels(
  labels: LabelData[],
  from?: number,
  to?: number,
): LabelData[] {
  if (from === undefined && to === undefined) return labels;

  const start = Math.max(0, (from ?? 1) - 1);
  const end = to ?? labels.length;
  if (start >= labels.length) return [];
  return labels.slice(start, end);
}

export function applyLabelSelection(
  labels: LabelData[],
  selection: LabelSelection,
): LabelData[] {
  let filtered = filterLabelsByGroups(labels, selection.groups);

  if (selection.index !== undefined) {
    if (selection.index < 0 || selection.index >= filtered.length) {
      throw new Error('Índice de etiqueta fuera de rango');
    }
    return filtered.slice(selection.index, selection.index + 1);
  }

  filtered = applyRangeToLabels(filtered, selection.from, selection.to);
  return filtered;
}
