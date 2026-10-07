export type NhietDoFactory = 'ASM1' | 'ASM2';
export type NhietDoFormType = 'regular' | 'special' | 'cold';

export interface NhietDoFormDef {
  id: string;
  factory: NhietDoFactory;
  formType: NhietDoFormType;
  titleVi: string;
  titleEn: string;
  sheetTitleVi: string;
  sheetTitleEn: string;
  icon: string;
  manageCode: string;
  docVersion: string;
  issuedDate: string;
}

export const NHET_DO_FORMS: NhietDoFormDef[] = [
  {
    id: 'ASM1-regular',
    factory: 'ASM1',
    formType: 'regular',
    titleVi: 'Kho Thường',
    titleEn: 'Regular Warehouse',
    sheetTitleVi: 'BẢNG KIỂM TRA NHIỆT ĐỘ, ĐỘ ẨM KHO THƯỜNG',
    sheetTitleEn: 'NORMAL WAREHOUSE TEMPERATURE AND HUMIDITY CHECKLIST',
    icon: 'warehouse',
    manageCode: 'WH-P01/F08',
    docVersion: '03',
    issuedDate: '26/05/2025'
  },
  {
    id: 'ASM1-special',
    factory: 'ASM1',
    formType: 'special',
    titleVi: 'Kho Mát',
    titleEn: 'Cool Warehouse',
    sheetTitleVi: 'BẢNG KIỂM TRA NHIỆT ĐỘ, ĐỘ ẨM KHO MÁT',
    sheetTitleEn: 'COOL WAREHOUSE TEMPERATURE AND HUMIDITY CHECKLIST',
    icon: 'inventory_2',
    manageCode: 'WH-P01/F07',
    docVersion: '08',
    issuedDate: '26/05/2025'
  },
  {
    id: 'ASM1-cold',
    factory: 'ASM1',
    formType: 'cold',
    titleVi: 'Tủ Lạnh',
    titleEn: 'Refrigerator',
    sheetTitleVi: 'BẢNG KIỂM TRA NHIỆT ĐỘ, ĐỘ ẨM KHU VỰC TỦ LẠNH',
    sheetTitleEn: 'CHECKLIST OF TEMPERATURE AND HUMIDITY IN REFRIGERATOR',
    icon: 'ac_unit',
    manageCode: 'WH-P01/F09',
    docVersion: '00',
    issuedDate: '26/05/2025'
  },
  {
    id: 'ASM2-regular',
    factory: 'ASM2',
    formType: 'regular',
    titleVi: 'Kho Thường',
    titleEn: 'Regular Warehouse',
    sheetTitleVi: 'BẢNG KIỂM TRA NHIỆT ĐỘ, ĐỘ ẨM KHO THƯỜNG',
    sheetTitleEn: 'NORMAL WAREHOUSE TEMPERATURE AND HUMIDITY CHECKLIST',
    icon: 'warehouse',
    manageCode: 'WH-P01/F08',
    docVersion: '03',
    issuedDate: '26/05/2025'
  },
  {
    id: 'ASM2-special',
    factory: 'ASM2',
    formType: 'special',
    titleVi: 'Kho Mát',
    titleEn: 'Cool Warehouse',
    sheetTitleVi: 'BẢNG KIỂM TRA NHIỆT ĐỘ, ĐỘ ẨM KHO MÁT',
    sheetTitleEn: 'COOL WAREHOUSE TEMPERATURE AND HUMIDITY CHECKLIST',
    icon: 'inventory_2',
    manageCode: 'WH-P01/F07',
    docVersion: '08',
    issuedDate: '26/05/2025'
  },
  {
    id: 'ASM2-cold',
    factory: 'ASM2',
    formType: 'cold',
    titleVi: 'Tủ Lạnh',
    titleEn: 'Refrigerator',
    sheetTitleVi: 'BẢNG KIỂM TRA NHIỆT ĐỘ, ĐỘ ẨM KHU VỰC TỦ LẠNH',
    sheetTitleEn: 'CHECKLIST OF TEMPERATURE AND HUMIDITY IN REFRIGERATOR',
    icon: 'ac_unit',
    manageCode: 'WH-P01/F09',
    docVersion: '00',
    issuedDate: '26/05/2025'
  }
];

export interface NhietDoFactoryGroup {
  factory: NhietDoFactory;
  labelVi: string;
  labelEn: string;
  accentClass: string;
  forms: NhietDoFormDef[];
}

/** Giới hạn nhiệt độ theo loại kho (vạch đỏ / tô màu ô). Cận dưới null = chỉ cận trên. */
export interface TempChartLimits {
  scaleMin: number;
  scaleMax: number;
  gridLines: number[];
  redLow: number | null;
  redHigh: number;
  warnLow: number | null;
  warnHigh: number;
  noteVi: string;
  noteEn: string;
}

/** Kho thường từ tháng 10/2026: chỉ cận trên. */
export const REGULAR_UPPER_ONLY_FROM = { year: 2026, month: 10 };

export function isNhietDoUpperOnlyPeriod(year: number, month: number): boolean {
  return year > REGULAR_UPPER_ONLY_FROM.year
    || (year === REGULAR_UPPER_ONLY_FROM.year && month >= REGULAR_UPPER_ONLY_FROM.month);
}

export interface HumChartLimits {
  scaleMin: number;
  scaleMax: number;
  gridLines: number[];
  redLow: number | null;
  redHigh: number;
  warnLow: number | null;
  warnHigh: number;
}

export const TEMP_LIMITS_BY_FORM: Record<NhietDoFormType, TempChartLimits> = {
  regular: {
    scaleMin: 5,
    scaleMax: 40,
    gridLines: [40, 35, 30, 25, 20, 15, 10, 5],
    redLow: 15,
    redHigh: 35,
    warnLow: 17,
    warnHigh: 33,
    noteVi: 'Nhiệt độ kho thường: 15°C – 35°C.',
    noteEn: 'Regular warehouse temperature: 15°C – 35°C.'
  },
  special: {
    scaleMin: 10,
    scaleMax: 30,
    gridLines: [30, 25, 20, 15, 10],
    redLow: 16,
    redHigh: 25,
    warnLow: 18,
    warnHigh: 23,
    noteVi: 'Nhiệt độ kho mát: 16°C – 25°C.',
    noteEn: 'Cool warehouse temperature: 16°C – 25°C.'
  },
  cold: {
    scaleMin: 0,
    scaleMax: 12,
    gridLines: [12, 10, 8, 6, 4, 2, 0],
    redLow: 2,
    redHigh: 8,
    warnLow: 2.5,
    warnHigh: 7.5,
    noteVi: 'Nhiệt độ tủ lạnh: 2°C – 8°C.',
    noteEn: 'Refrigerator temperature: 2°C – 8°C.'
  }
};

/** Kho thường từ 01/10/2026: tối đa 40°C, cảnh báo 39°C, không cận dưới. */
export const REGULAR_TEMP_LIMITS_UPPER: TempChartLimits = {
  scaleMin: 5,
  scaleMax: 45,
  gridLines: [45, 40, 35, 30, 25, 20, 15, 10, 5],
  redLow: null,
  redHigh: 40,
  warnLow: null,
  warnHigh: 39,
  noteVi: 'Nhiệt độ kho thường: tối đa 40°C, cảnh báo 39°C.',
  noteEn: 'Regular warehouse temperature: max 40°C, warning 39°C.'
};

export const HUM_LIMITS_RANGE: HumChartLimits = {
  scaleMin: 20,
  scaleMax: 85,
  gridLines: [85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25, 20],
  redLow: 25,
  redHigh: 75,
  warnLow: 27,
  warnHigh: 73
};

/** Độ ẩm kho thường từ 01/10/2026: tối đa 85%, cảnh báo 84%, không cận dưới. */
export const HUM_LIMITS_UPPER: HumChartLimits = {
  scaleMin: 20,
  scaleMax: 100,
  gridLines: [100, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25, 20],
  redLow: null,
  redHigh: 85,
  warnLow: null,
  warnHigh: 84
};

/** Độ ẩm kho mát và tủ lạnh từ 01/10/2026: tối đa 75% (dưới 75 là đạt), cảnh báo 74%, không cận dưới. */
export const HUM_LIMITS_COOL_COLD: HumChartLimits = {
  scaleMin: 20,
  scaleMax: 100,
  gridLines: [100, 90, 80, 75, 70, 60, 50, 40, 30, 20],
  redLow: null,
  redHigh: 75,
  warnLow: null,
  warnHigh: 74
};

/** Lưu ý đầy đủ — Kho Thường (F08), Kho Đặc Biệt (F07), Tủ Lạnh (F09) */
export interface SheetNoteLine {
  vi: string;
  en: string;
}

export function regularWarehouseSheetNotes(upperOnly: boolean): {
  grid: SheetNoteLine[];
  list: SheetNoteLine[];
} {
  const notes = REGULAR_WAREHOUSE_SHEET_NOTES;
  if (!upperOnly) return notes;
  return {
    grid: [
      {
        vi: '1. Nhiệt độ kho thường: tối đa 40°C, cảnh báo 39°C',
        en: 'Normal warehouse temperature: max 40°C, warning 39°C'
      },
      notes.grid[1],
      notes.grid[2],
      {
        vi: '4. Độ ẩm kho thường: tối đa 85%, cảnh báo 84%. Độ ẩm kho mát và tủ lạnh: tối đa 75%, cảnh báo 74%',
        en: 'Normal warehouse humidity: max 85%, warning 84%. Cool warehouse and refrigerator humidity: max 75%, warning 74%'
      }
    ],
    list: notes.list
  };
}

export const REGULAR_WAREHOUSE_SHEET_NOTES: {
  grid: SheetNoteLine[];
  list: SheetNoteLine[];
} = {
  grid: [
    {
      vi: '1. Nhiệt độ kho thường: 15-35°C',
      en: 'Normal warehouse temperature: 15-35°C'
    },
    {
      vi: '2. Nhiệt độ kho mát: 16-25°C',
      en: 'Cool warehouse temperature: 16-25°C'
    },
    {
      vi: '3. Nhiệt độ tủ lạnh 2-8°C',
      en: 'Refrigerator temperature 2-8°C'
    },
    {
      vi: '4. Độ ẩm: 25%-75%',
      en: 'Humidity: 25%-75%'
    }
  ],
  list: [
    {
      vi: '5. Thời gian kiểm tra : sáng (9:00 am) và chiều ( 3:00 pm).',
      en: 'Check time: morning (9:00 am) and afternoon (3:00 pm).'
    },
    {
      vi: '6. Khi nhiệt độ, độ ẩm vượt gần tới mức giới hạn , đồng hồ sẽ phát tín hiệu cảnh báo bằng âm thanh, cần tiến hành điều chỉnh nhiệt độ, độ ẩm bằng cách mở điều hòa/ quạt, máy hút ẩm.',
      en: 'When the temperature and humidity are close to the limit, the watch will give an audible warning signal. It is necessary to adjust the temperature and humidity by turning on the air conditioner/fan or dehumidifier.'
    },
    {
      vi: '7. Khi nhiệt độ hoặc độ ẩm chạm ngưỡng cảnh báo (tiếp xúc đường màu vàng), người kiểm tra ngay lập tức thông báo cho trưởng bộ phận để xử lý kịp thời.',
      en: 'When the temperature or humidity reaches the warning threshold (contacts the yellow line), the inspector immediately notifies the department head for timely handling.'
    }
  ]
};

export function buildNhietDoFactoryGroups(): NhietDoFactoryGroup[] {
  return [
    {
      factory: 'ASM1',
      labelVi: 'ASM1',
      labelEn: 'ASM1',
      accentClass: 'nhiet-do-hub__section--asm1',
      forms: NHET_DO_FORMS.filter(f => f.factory === 'ASM1')
    },
    {
      factory: 'ASM2',
      labelVi: 'ASM2',
      labelEn: 'ASM2',
      accentClass: 'nhiet-do-hub__section--asm2',
      forms: NHET_DO_FORMS.filter(f => f.factory === 'ASM2')
    }
  ];
}
