import { ChecklistItem, Equipment, EquipmentCategory } from './equipment-checklist.models';
import { SEED_CATEGORIES } from './equipment-checklist.seed';

export const EQUIPMENT_CATEGORIES: EquipmentCategory[] = SEED_CATEGORIES.flatMap(category =>
  category.subcategories.map(sub => ({
    categoryId: category.id,
    categoryName: category.name,
    subcategoryId: sub.id,
    subcategoryName: sub.name
  }))
);

export const EQUIPMENT_CHECKLIST_ITEMS: ChecklistItem[] = SEED_CATEGORIES.flatMap(category =>
  category.subcategories.flatMap(sub =>
    sub.inspectionItems.map((itemName, index) => ({
      checklistId: `${sub.id}-${index + 1}`,
      subcategoryId: sub.id,
      itemName,
      sequence: index + 1,
      active: true
    }))
  )
);

export function categoryName(categoryId: string): string {
  return EQUIPMENT_CATEGORIES.find(c => c.categoryId === categoryId)?.categoryName || categoryId;
}

export function subcategoryName(subcategoryId: string): string {
  return EQUIPMENT_CATEGORIES.find(c => c.subcategoryId === subcategoryId)?.subcategoryName || subcategoryId;
}

export function checklistFor(subcategoryId: string): ChecklistItem[] {
  return EQUIPMENT_CHECKLIST_ITEMS
    .filter(item => item.subcategoryId === subcategoryId && item.active)
    .sort((a, b) => a.sequence - b.sequence);
}

export function checklistNames(eq: { subcategoryId: string; inspectionItems?: string[] }): string[] {
  if (eq.inspectionItems?.length) return eq.inspectionItems;
  return checklistFor(eq.subcategoryId).map(item => item.itemName);
}
