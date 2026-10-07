export interface StorageMaterialGroup {
  no: number;
  materialType: string;
  materialCodes: string[];
  environment: 'NORMAL' | 'COOL' | 'COLD' | 'NORMAL_COOL' | 'NORMAL_COLD';
  note?: string;
}

export const STORAGE_MATERIAL_GROUPS: StorageMaterialGroup[] = [
  {
    no: 1,
    materialType: 'Dây điện',
    materialCodes: [
      'B001xxx',
      'B002xxx',
      'B003xxx',
      'B005xxx',
      'B006xxx',
      'B038xxx'
    ],
    environment: 'NORMAL'
  },
  {
    no: 2,
    materialType: 'Đầu nối (Connector)',
    materialCodes: [
      'B007xxx',
      'B008xxx',
      'B009xxx',
      'B016xxx',
      'B018xxx'
    ],
    environment: 'NORMAL'
  },
  {
    no: 3,
    materialType: 'Parts nhựa',
    materialCodes: [
      'B011xxx',
      'B013xxx',
      'B014xxx',
      'B015xxx'
    ],
    environment: 'NORMAL'
  },
  {
    no: 4,
    materialType: 'Tube',
    materialCodes: [
      'B017xxx',
      'B042xxx'
    ],
    environment: 'NORMAL'
  },
  {
    no: 5,
    materialType: 'Parts Kim loại',
    materialCodes: [
      'B018xxx',
      'B019xxx',
      'B020xxx',
      'B021xxx'
    ],
    environment: 'NORMAL'
  },
  {
    no: 6,
    materialType: 'Electronic Components, PCB, PCBA, Solder',
    materialCodes: [
      'B022xxx',
      'B023xxx',
      'B024xxx',
      'B025xxx',
      'B026xxx',
      'B027xxx',
      'B033xxx'
    ],
    environment: 'NORMAL_COLD',
    note: 'PCBA lưu trữ trong môi trường mát'
  },
  {
    no: 7,
    materialType: 'All Carton, Label, Tie, PE Bag',
    materialCodes: [
      'B028xxx',
      'B029xxx',
      'B030xxx',
      'B031xxx',
      'B032xxx',
      'B036xxx',
      'B041xxx'
    ],
    environment: 'NORMAL'
  },
  {
    no: 8,
    materialType: '034_Tape-Copper foil',
    materialCodes: [
      'B034xxx'
    ],
    environment: 'COOL'
  },
  {
    no: 9,
    materialType: 'Keo Epoxy',
    materialCodes: [
      'B037001'
    ],
    environment: 'COOL'
  },
  {
    no: 10,
    materialType: 'Keo AB',
    materialCodes: [
      'B037002'
    ],
    environment: 'COOL'
  },
  {
    no: 11,
    materialType: 'Keo dán làm kín Sealant P/N: RTV 734',
    materialCodes: [
      'B037012'
    ],
    environment: 'COOL'
  },
  {
    no: 12,
    materialType: 'Chất nhũ tương bôi trơn cao su Lubricant rubber emulsion',
    materialCodes: [
      'B037013'
    ],
    environment: 'COOL'
  },
  {
    no: 13,
    materialType: 'Keo dán Adhesive sealant Momentive RTV162',
    materialCodes: [
      'B037017'
    ],
    environment: 'COOL'
  },
  {
    no: 14,
    materialType: 'Keo UV GLUE Đông Quan Taylor',
    materialCodes: [
      'B037033'
    ],
    environment: 'COOL'
  },
  {
    no: 15,
    materialType: 'Keo dán Glue Loctite 495',
    materialCodes: [
      'B037005'
    ],
    environment: 'COLD'
  },
  {
    no: 16,
    materialType: 'Keo dán LOCTITE 401',
    materialCodes: [
      'B037015'
    ],
    environment: 'COLD'
  },
  {
    no: 17,
    materialType: 'Keo dán LOCTITE 770',
    materialCodes: [
      'B037016'
    ],
    environment: 'COLD'
  }
];

export const STORAGE_ENV_LABEL: Record<StorageMaterialGroup['environment'], string> = {
  NORMAL: 'Kho thường',
  COOL: 'Kho mát',
  COLD: 'Kho lạnh',
  NORMAL_COOL: 'Kho thường / Kho mát',
  NORMAL_COLD: 'Kho thường / Kho lạnh'
};

/** Ngưỡng đang áp dụng (từ 01/10/2026): kho thường ≤ 40°C / độ ẩm ≤ 85%; kho mát 16–25°C và kho lạnh 2–8°C, độ ẩm tối đa 75%. */
export const STORAGE_ENV_CLIMATE: Record<StorageMaterialGroup['environment'], { temperature: string; humidity: string }> = {
  NORMAL: { temperature: '≤ 40°C', humidity: '≤ 85%' },
  COOL: { temperature: '16–25°C', humidity: '≤ 75%' },
  COLD: { temperature: '2–8°C', humidity: '≤ 75%' },
  NORMAL_COOL: { temperature: 'Kho thường ≤ 40°C\nKho mát 16–25°C', humidity: 'Kho thường ≤ 85%\nKho mát ≤ 75%' },
  NORMAL_COLD: { temperature: 'Kho thường ≤ 40°C\nKho lạnh 2–8°C', humidity: 'Kho thường ≤ 85%\nKho lạnh ≤ 75%' }
};
