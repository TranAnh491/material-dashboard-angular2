import { Equipment } from './equipment-checklist.models';

export interface SeedSubcategory {
  id: string;
  name: string;
  description?: string;
  inspectionItems: string[];
  equipment: Array<{
    stt: number;
    name: string;
    managementCode: string;
    responsiblePerson: string | null;
    inspectionItems?: string[];
  }>;
}

export interface SeedCategory {
  id: string;
  name: string;
  subcategories: SeedSubcategory[];
}

export const SEED_CATEGORIES: SeedCategory[] = [
  {
    id: 'CAT-01',
    name: 'NHÓM THIẾT BỊ NÂNG HẠ & VẬN CHUYỂN',
    subcategories: [
      {
        id: 'CAT-01-01',
        name: 'Nhóm thiết bị xe nâng điện thấp (Pallet Truck)',
        description: 'Chuyên kéo đi mặt đất, không nâng cao xếp kệ',
        inspectionItems: ['Pin', 'Phanh', 'Thủy lực', 'Bánh xe'],
        equipment: [
          { stt: 1, name: 'Xe nâng điện PTE15N (tải 1500 kg/càng rộng)', managementCode: 'WH-XNĐ_002', responsiblePerson: 'Nguyễn Hoàng Tuấn' },
          { stt: 2, name: 'Xe nâng điện PTE15N (tải 1500 kg/càng rộng)', managementCode: 'WH-XNĐ_003', responsiblePerson: 'Nguyễn Hoàng Tuấn' },
          { stt: 3, name: 'Xe nâng điện PTE15N (tải 1500 kg/càng rộng)', managementCode: 'WH-XNĐ_004', responsiblePerson: 'Nguyễn Hoàng Tuấn' },
          { stt: 4, name: 'Xe nâng điện PTE15N (tải 1500 kg/càng rộng)', managementCode: 'WH-XNĐ_008', responsiblePerson: 'Nguyễn Hoàng Tuấn' },
          { stt: 5, name: 'Xe nâng điện PTE15N (tải 1500 kg/càng rộng)', managementCode: 'WH-XNĐ_007', responsiblePerson: 'Nguyễn Hoàng Phúc' },
          { stt: 6, name: 'Xe nâng điện TIANYULUX (tải 3000 kg/kích thước càng 685*1220mm)', managementCode: 'WH-XNĐ_009', responsiblePerson: 'Ngô Hoàng Thanh' },
          { stt: 7, name: 'Xe nâng điện thấp PWB150, sức nâng 1500kg, rộng 685*1150mm', managementCode: 'WH-XNĐ_011', responsiblePerson: 'Nguyễn Minh Phụng' }
        ]
      },
      {
        id: 'CAT-01-02',
        name: 'Nhóm thiết bị xe nâng điện xếp chồng (Stacker)',
        description: 'Vừa di chuyển điện vừa nâng cao xếp kệ',
        inspectionItems: ['Pin', 'Thủy lực', 'Xích nâng', 'Bánh xe', 'Hệ thống phanh (thắng)', 'Công tắc/cần điều khiển'],
        equipment: [
          { stt: 1, name: 'Xe nâng hàng PS 16N', managementCode: 'WH-XNĐ_005', responsiblePerson: 'Huỳnh Hữu Tình' }
        ]
      },
      {
        id: 'CAT-01-03',
        name: 'Nhóm thiết bị xe nâng Reach Truck ngồi lái',
        inspectionItems: ['Pin', 'Phanh', 'Khung nâng', 'Còi', 'Đèn', 'Hệ thống lái', 'Vô lăng/motor lái'],
        equipment: [
          { stt: 1, name: 'Xe nâng điện Reach Truck ngồi lái 2000kg/7m Type RT20P', managementCode: 'WH-XNĐ_006', responsiblePerson: 'Nguyễn Hoàng Phúc' }
        ]
      },
      {
        id: 'CAT-01-04',
        name: 'Nhóm thiết bị xe nâng bán tự động (Semi-electric stacker)',
        description: 'Kéo tay, nâng điện',
        inspectionItems: ['Pin', 'Thủy lực', 'Xích nâng', 'Bánh xe', 'Hệ thống phanh (thắng)', 'Công tắc/cần điều khiển'],
        equipment: [
          { stt: 1, name: 'Xe nâng bán tự động MAIHUI CDSD1.5-3.5 (1500kg)', managementCode: 'WH-XNĐ_001', responsiblePerson: 'Huỳnh Hữu Tình' },
          { stt: 2, name: 'Xe nâng hạ hàng SH-110', managementCode: 'WH-XNĐ_010', responsiblePerson: 'Huỳnh Hữu Tình' }
        ]
      },
      {
        id: 'CAT-01-05',
        name: 'Nhóm thiết bị xe nâng tay thủy lực',
        inspectionItems: ['Khung gầm', 'Càng nâng', 'Hệ thống bơm thủy lực tay', 'Bánh xe'],
        equipment: [
          { stt: 1, name: 'Xe nâng tay siêu nhỏ càng dài 800mm, tải 2500kg', managementCode: 'WH-XNT_001', responsiblePerson: 'Nguyễn Minh Phụng' },
          { stt: 2, name: 'Xe nâng tay Noblelift AC30 càng rộng (3000kg)', managementCode: 'WH-XNT_002', responsiblePerson: 'Nguyễn Hoàng Phúc' }
        ]
      },
      {
        id: 'CAT-01-06',
        name: 'Nhóm thiết bị hỗ trợ dịch chuyển tải nặng',
        inspectionItems: ['Mâm xoay', 'Vòng bi', 'Bánh xe chịu lực', 'Khung bệ'],
        equipment: [
          { stt: 1, name: 'Xe nâng Rùa xoay 360 độ, 2 tấn, model CPR 3', managementCode: 'WH-XNT_003', responsiblePerson: 'Nguyễn Hoàng Phúc' }
        ]
      }
    ]
  },
  {
    id: 'CAT-02',
    name: 'NHÓM THIẾT BỊ ĐÓNG GÓI & IN ẤN',
    subcategories: [
      {
        id: 'CAT-02-01',
        name: 'Nhóm thiết bị đóng gói',
        inspectionItems: ['Dây nguồn', 'Phích cắm', 'Lực căng dây', 'Chất lượng mối hàn', 'Âm thanh & Động cơ', 'Vệ sinh tổng thể máy'],
        equipment: [
          { stt: 1, name: 'Máy đóng dây đai thùng tự động Chali JN-740', managementCode: 'WH-MĐT_001', responsiblePerson: 'Nguyễn Minh Phụng' },
          { stt: 2, name: 'Máy đai thùng bán tự động TP-201', managementCode: 'WH-MĐT_003', responsiblePerson: 'Nguyễn Minh Phụng' },
          { stt: 3, name: 'Máy đóng dây đai thùng tự động Chali JN-740', managementCode: 'WH-MĐT_004', responsiblePerson: 'Nguyễn Minh Phụng' },
          { stt: 4, name: 'Máy đóng dây đai thùng tự động Chali JN-740', managementCode: 'WH-MĐT_002', responsiblePerson: 'Nguyễn Hoàng Phúc' },
          { stt: 5, name: 'Máy cưa bàn Stanley SST1801', managementCode: 'WH-MCB-001', responsiblePerson: 'Nguyễn Minh Phụng', inspectionItems: ['Lưỡi cưa', 'Chắn bảo vệ', 'Bàn trượt/cữ', 'Nguồn điện'] },
          { stt: 6, name: 'Máy cưa bàn Stanley SST1801', managementCode: 'WH-MCB-003', responsiblePerson: 'Nguyễn Minh Phụng', inspectionItems: ['Lưỡi cưa', 'Chắn bảo vệ', 'Bàn trượt/cữ', 'Nguồn điện'] },
          { stt: 7, name: 'Máy cưa bàn Stanley SST1801', managementCode: 'WH-MCB-002', responsiblePerson: 'Nguyễn Hoàng Phúc', inspectionItems: ['Lưỡi cưa', 'Chắn bảo vệ', 'Bàn trượt/cữ', 'Nguồn điện'] }
        ]
      },
      {
        id: 'CAT-02-02',
        name: 'Nhóm thiết bị in ấn',
        inspectionItems: ['Đầu in', 'Trục rulo', 'Dây nguồn', 'Chất lượng bản in'],
        equipment: [
          { stt: 1, name: 'Máy in mã vạch Zebra ZD230', managementCode: 'WH-MI-001', responsiblePerson: null },
          { stt: 2, name: 'Máy in mã vạch Zebra ZD230', managementCode: 'WH-MI-002', responsiblePerson: null },
          { stt: 3, name: 'Máy in Brother MFC_L2701DW', managementCode: 'WH-MI-005', responsiblePerson: null },
          { stt: 4, name: 'Máy in mã vạch Zebra ZD230', managementCode: 'WH-MI-010', responsiblePerson: null },
          { stt: 5, name: 'Máy in mã vạch Zebra ZD230', managementCode: 'WH-MI-011', responsiblePerson: null },
          { stt: 6, name: 'Máy in mã vạch Zebra ZD230', managementCode: 'WH-MI-013', responsiblePerson: null },
          { stt: 7, name: 'Máy in mã vạch Zebra ZT411 - 300 dpi PN: ZT41143-T0P0000Z', managementCode: 'WH-MI-015', responsiblePerson: null },
          { stt: 8, name: 'Máy in nhãn Brother PT-P900W', managementCode: 'WH-MI-018', responsiblePerson: null },
          { stt: 9, name: 'Máy in ống co nhiệt Supvan TP86E', managementCode: 'WH-MI-019', responsiblePerson: null },
          { stt: 10, name: 'Máy in mã vạch Zebra ZT411 - 300 dpi PN: ZT41143-T0P0000Z', managementCode: 'WH-MI-020', responsiblePerson: null },
          { stt: 11, name: 'Máy in mã vạch Zebra ZT410/ZT411 -300dpi, PN: P1058930-010', managementCode: 'WH-MI-021', responsiblePerson: null },
          { stt: 12, name: 'Máy in mã vạch Gainscha B300', managementCode: 'WH-MI-022', responsiblePerson: null },
          { stt: 16, name: 'Máy in mã vạch Zebra ZD230T', managementCode: 'WH-MI-006', responsiblePerson: 'Nguyễn Hoàng Phúc' },
          { stt: 17, name: 'Máy in mã vạch Zebra ZD230T', managementCode: 'WH-MI-007', responsiblePerson: 'Nguyễn Hoàng Phúc' },
          { stt: 18, name: 'Máy in Brother MFC_L2701DW', managementCode: 'WH-MI-009', responsiblePerson: 'Nguyễn Hoàng Phúc' },
          { stt: 19, name: 'Máy in mã vạch Zebra ZD230T', managementCode: 'WH-MI-012', responsiblePerson: 'Nguyễn Hoàng Phúc' },
          { stt: 23, name: 'Máy ép Plastic Laminator 320', managementCode: 'WH-ME-001', responsiblePerson: null, inspectionItems: ['Nguồn điện', 'Núm chỉnh nhiệt độ', 'Trục ép', 'Vệ sinh rulo'] },
          { stt: 24, name: 'Máy ép Plastic Laminator 320', managementCode: 'WH-ME-002', responsiblePerson: 'Nguyễn Hoàng Phúc', inspectionItems: ['Nguồn điện', 'Núm chỉnh nhiệt độ', 'Trục ép', 'Vệ sinh rulo'] }
        ]
      }
    ]
  },
  {
    id: 'CAT-03',
    name: 'NHÓM THIẾT BỊ CÂN - ĐO LƯỜNG',
    subcategories: [
      {
        id: 'CAT-03-01',
        name: 'Nhóm thiết bị cân',
        inspectionItems: ['Mặt bàn cân', 'Màn hình hiển thị', 'Nguồn/pin', 'Độ ổn định số liệu'],
        equipment: [
          { stt: 1, name: 'Cân điện tử - Cân 3 kg (ALC-3C+)', managementCode: 'WH-ES-001', responsiblePerson: null },
          { stt: 2, name: 'Cân điện tử - cân 100kg (XK3190-T7E)', managementCode: 'WH-ES-002', responsiblePerson: null },
          { stt: 3, name: 'Cân điện tử - cân 1.2kg (KD-TBED-1200)', managementCode: 'WH-ES-003', responsiblePerson: null },
          { stt: 4, name: 'Cân điện tử - cân 1.2kg (KD-TBED-1200)', managementCode: 'WH-ES-004', responsiblePerson: null },
          { stt: 5, name: 'Cân điện tử (2.5CS)', managementCode: 'WH-ES-005', responsiblePerson: null },
          { stt: 6, name: 'Cân điện tử 15kg (JCL-15K)', managementCode: 'WH-ES-006', responsiblePerson: null },
          { stt: 7, name: 'Cân điện tử 15kg (JCL-15K)', managementCode: 'WH-ES-007', responsiblePerson: null },
          { stt: 8, name: 'Cân điện tử (2.5CS)', managementCode: 'WH-ES-008', responsiblePerson: null },
          { stt: 9, name: 'Cân điện tử TPS30PSW 30kg', managementCode: 'WH-ES-010', responsiblePerson: null },
          { stt: 10, name: 'Cân điện tử - cân 1.2kg (KD-TBED-1200)', managementCode: 'WH-ES-011', responsiblePerson: null },
          { stt: 11, name: 'Cân điện tử TAIWAN THW 100kg 501E', managementCode: 'WH-ES-015', responsiblePerson: null },
          { stt: 12, name: 'Cân điện tử TPS30DS (30kg)', managementCode: 'WH-ES-016', responsiblePerson: null },
          { stt: 13, name: 'Cân điện tử IND-PLU PC 100kg, e=d: 10g', managementCode: 'WH-ES-017', responsiblePerson: null },
          { stt: 14, name: 'Cân điện tử IND-PLU PC 100kg, e=d: 10g', managementCode: 'WH-ES-018', responsiblePerson: null },
          { stt: 15, name: 'Xe nâng tay gắn cân HPT20S (Tải 2000kg)', managementCode: 'WH-ES-021', responsiblePerson: null },
          { stt: 16, name: 'Cân điện tử kỹ thuật Đức BEC BDC-BEC-3202B 3200g', managementCode: 'WH-ES-022', responsiblePerson: null },
          { stt: 17, name: 'Cân điện tử Jadever JCL 15kg x 0.5g', managementCode: 'WH-ES-014', responsiblePerson: 'Nguyễn Hoàng Phúc' },
          { stt: 18, name: 'Cân điện tử KD-TBED-1200', managementCode: 'WH-ES-013', responsiblePerson: 'Nguyễn Hoàng Phúc' },
          { stt: 19, name: 'Cân điện tử TAIWAN THW 100kg 501E', managementCode: 'WH-ES-012', responsiblePerson: 'Nguyễn Hoàng Phúc' },
          { stt: 20, name: 'Cân điện tử IND-PLU PC 100kg, e=d: 10g', managementCode: 'WH-ES-019', responsiblePerson: 'Nguyễn Hoàng Phúc' },
          { stt: 21, name: 'Cân điện tử TPS30PSW - Cân 30kg', managementCode: 'WH-ES-020', responsiblePerson: 'Nguyễn Hoàng Phúc' }
        ]
      },
      {
        id: 'CAT-03-02',
        name: 'Nhóm thiết bị đo lường',
        inspectionItems: ['Màn hình hiển thị', 'Pin/nguồn', 'Cảm biến/đầu đo', 'Phím bấm'],
        equipment: [
          { stt: 1, name: 'Máy đo nhiệt độ độ ẩm Laserliner 082.031A', managementCode: 'WH-DHT-008', responsiblePerson: null },
          { stt: 2, name: 'Đồng hồ đo nhiệt độ độ ẩm nhỏ AT956', managementCode: 'WH-DHT-012', responsiblePerson: null },
          { stt: 3, name: 'Đồng hồ đo nhiệt độ độ ẩm nhỏ AT956', managementCode: 'WH-DHT-013', responsiblePerson: null },
          { stt: 4, name: 'Nhiệt kế đo nhiệt độ độ ẩm DELIXI DM-1045', managementCode: 'WH-DHT-016', responsiblePerson: null },
          { stt: 5, name: 'Máy đo độ ẩm Extech MO210 (đo độ ẩm pallet gỗ)', managementCode: 'WH-MM-001', responsiblePerson: null },
          { stt: 6, name: 'Máy đo lực kéo/đẩy điện tử ALIYIQI SF-500 (500N/0.1N)', managementCode: 'WH-PFT-0001', responsiblePerson: null },
          { stt: 7, name: 'Thước thủy điện tử MOORE & WRIGHT MW580-02 (225mm/9”)', managementCode: 'WH-PID-001', responsiblePerson: null },
          { stt: 8, name: 'Thước cuộn đo điện tử 5m/25mm Koiss K525L có đèn nền', managementCode: 'WH-TM-001', responsiblePerson: null },
          { stt: 9, name: 'Thước cuộn đo điện tử 5m/25mm Koiss K525L có đèn nền', managementCode: 'WH-TM-002', responsiblePerson: null },
          { stt: 10, name: 'Máy đo nhiệt độ độ ẩm Laserliner 082.031A', managementCode: 'WH-DHT-009', responsiblePerson: 'Nguyễn Hoàng Phúc' },
          { stt: 11, name: 'Đồng hồ đo nhiệt độ độ ẩm nhỏ AT956', managementCode: 'WH-DHT-014', responsiblePerson: 'Nguyễn Hoàng Phúc' },
          { stt: 12, name: 'Máy đo độ ẩm Extech MO210', managementCode: 'WH-MM-002', responsiblePerson: 'Nguyễn Hoàng Phúc' },
          { stt: 13, name: 'Đồng hồ đo nhiệt độ độ ẩm nhỏ AT956', managementCode: 'WH-DHT-015', responsiblePerson: 'Nguyễn Hoàng Phúc' }
        ]
      },
      {
        id: 'CAT-03-03',
        name: 'Nhóm thiết bị kiểm soát môi trường',
        inspectionItems: ['Đường ống thoát nước', 'Màng lọc khí', 'Bảng điều khiển', 'Độ ẩm cài đặt'],
        equipment: [
          { stt: 1, name: 'Máy hút ẩm Harison HD-100BM', managementCode: 'WH-MHA_001', responsiblePerson: 'Huỳnh Hữu Tình' },
          { stt: 2, name: 'Máy hút ẩm Harison HD-100MB', managementCode: 'WH-MHA-002', responsiblePerson: 'Nguyễn Hoàng Phúc' }
        ]
      }
    ]
  },
  {
    id: 'CAT-04',
    name: 'NHÓM THIẾT BỊ SCAN',
    subcategories: [
      {
        id: 'CAT-04-01',
        name: 'Nhóm thiết bị Scan',
        inspectionItems: ['Mặt kính mắt đọc', 'Kết nối (dây/Bluetooth)', 'Pin', 'Nút cò quét'],
        equipment: [
          { stt: 1, name: 'Máy quét Symcode MJ-2877 (quét được 1D và 2D)', managementCode: 'WH-KK-001', responsiblePerson: null },
          { stt: 2, name: 'Máy quét mã vạch Honeywell 1472G-2D', managementCode: 'WH-MĐMV-002', responsiblePerson: null },
          { stt: 3, name: 'Máy quét mã vạch Honeywell 1472G-2D', managementCode: 'WH-MĐMV-005', responsiblePerson: null },
          { stt: 4, name: 'Máy quét mã vạch không dây Unitech 2D MS838B', managementCode: 'WH-MĐMV-006', responsiblePerson: null },
          { stt: 5, name: 'Máy quét mã vạch Honeywell 1472G-2D', managementCode: 'WH-MĐMV-007', responsiblePerson: null },
          { stt: 6, name: 'Máy quét mã vạch Honeywell 1472G-2D', managementCode: 'WH-MĐMV-008', responsiblePerson: null },
          { stt: 7, name: 'Máy quét mã vạch Tera 1D', managementCode: 'WH-MĐMV-009', responsiblePerson: null },
          { stt: 8, name: 'Máy quét mã vạch Clip Scanner OPTORI OPN4000', managementCode: 'WH-MĐMV-010', responsiblePerson: null },
          { stt: 9, name: 'Máy quét mã vạch OPTORI RS38 V2 (Nhẫn scan)', managementCode: 'WH-MĐMV-011', responsiblePerson: null },
          { stt: 10, name: 'Máy quét mã vạch OPTORI H29', managementCode: 'WH-MĐMV-012', responsiblePerson: null },
          { stt: 11, name: 'Máy quét mã vạch OPTORI H29', managementCode: 'WH-MĐMV-013', responsiblePerson: null },
          { stt: 12, name: 'Máy đọc mã vạch POINT MOBILE PM84 (PDA)', managementCode: 'WH-MĐMV-014', responsiblePerson: null },
          { stt: 13, name: 'Máy đọc mã vạch POINT MOBILE PM84 (PDA)', managementCode: 'WH-MĐMV-015', responsiblePerson: null },
          { stt: 14, name: 'Máy kiểm kho PDA iData T3 Pro', managementCode: 'WH-KK-002', responsiblePerson: null },
          { stt: 15, name: 'Máy quét mã vạch Honeywell 1472G-2D', managementCode: 'WH-MĐMV-004', responsiblePerson: 'Nguyễn Hoàng Phúc' },
          { stt: 16, name: 'Máy quét mã vạch Honeywell 1950GHD-2USB-A', managementCode: 'WH-MĐMV-003', responsiblePerson: 'Nguyễn Hoàng Phúc' },
          { stt: 17, name: 'Máy đọc mã vạch POINT MOBILE PM84', managementCode: 'WH-MĐMV-016', responsiblePerson: 'Nguyễn Hoàng Phúc' }
        ]
      }
    ]
  },
  {
    id: 'CAT-05',
    name: 'NHÓM THIẾT BỊ ĐIỆN - ĐIỆN TỬ - CƠ KHÍ',
    subcategories: [
      {
        id: 'CAT-05-01',
        name: 'Nhóm thiết bị làm mát',
        inspectionItems: ['Dây nguồn', 'Lồng/cánh quạt', 'Công tắc'],
        equipment: [
          { stt: 1, name: 'Quạt công nghiệp 20" DeWalt DXF2035', managementCode: 'KZ 7pcs', responsiblePerson: 'Ngô Hoàng Thanh' },
          { stt: 2, name: 'Quạt đứng công nghiệp Caterpillar HVPD-14AC - 14 inch', managementCode: 'KZ 1pcs', responsiblePerson: 'Hồ Hoàng Vũ' },
          { stt: 3, name: 'Quạt công nghiệp 20" DeWalt DXF2035', managementCode: 'LH 2pcs', responsiblePerson: 'Nguyễn Hoàng Phúc' },
          { stt: 4, name: 'Quạt đứng công nghiệp Caterpillar HVPD-14AC - 14 inch', managementCode: 'LH 1pcs', responsiblePerson: 'Nguyễn Hoàng Phúc' }
        ]
      },
      {
        id: 'CAT-05-02',
        name: 'Nhóm thiết bị điện lạnh',
        inspectionItems: ['Nguồn điện', 'Nhiệt độ', 'Gioăng cửa', 'Vệ sinh'],
        equipment: [
          { stt: 1, name: 'Tủ mát 195 Lít HSR S6195', managementCode: 'WH-TM-002', responsiblePerson: 'Huỳnh Hữu Tình' },
          { stt: 2, name: 'Tủ Mát Hoà Phát 195 Lít HSR S6195', managementCode: 'WH-TM-003', responsiblePerson: 'Nguyễn Hoàng Phúc' }
        ]
      },
      {
        id: 'CAT-05-03',
        name: 'Nhóm thiết bị công nghệ thông tin/điện tử hiển thị',
        inspectionItems: ['Màn hình hiển thị', 'Dung lượng pin/sạc', 'Kết nối Wi-Fi', 'Phím nguồn'],
        equipment: [
          { stt: 1, name: 'Smart Tivi Samsung 4K 55 inch 55DU7700', managementCode: 'WH-TV-001', responsiblePerson: null },
          { stt: 2, name: 'Máy tính bảng NOKIA', managementCode: 'WH-MTB-001', responsiblePerson: null },
          { stt: 3, name: 'Máy tính bảng NOKIA', managementCode: 'WH-MTB-002', responsiblePerson: null },
          { stt: 4, name: 'Máy tính bảng REDMI PAD SE 6G/128G', managementCode: 'WH-MTB-003', responsiblePerson: null },
          { stt: 5, name: 'Máy tính bảng REDMI PAD SE 6G/128G', managementCode: 'WH-MTB-004', responsiblePerson: null }
        ]
      },
      {
        id: 'CAT-05-04',
        name: 'Nhóm thiết bị vệ sinh',
        inspectionItems: ['Dây nguồn', 'Thùng chứa', 'Màng lọc'],
        equipment: [
          { stt: 1, name: 'Máy hút bụi Stanley Model SL19417-6A', managementCode: 'WH-MHB-001', responsiblePerson: 'Hồ Hoàng Vũ' },
          { stt: 2, name: 'Máy hút bụi Stanley 30L Model SL19417-8AB', managementCode: 'WH-MHB-003', responsiblePerson: 'Hồ Hoàng Vũ' },
          { stt: 3, name: 'Máy hút bụi Stanley Model SL19417-6A', managementCode: 'WH-MHB-002', responsiblePerson: 'Nguyễn Hoàng Phúc' }
        ]
      },
      {
        id: 'CAT-05-05',
        name: 'Nhóm thiết bị dụng cụ cầm tay dùng pin',
        inspectionItems: ['Pin', 'Cò bóp', 'Đầu kẹp/đầu vặn'],
        equipment: [
          { stt: 1, name: 'Máy bơm hơi cầm tay tự động dùng pin 20V Total TACLI20021', managementCode: 'WH-MBH-001', responsiblePerson: 'Nguyễn Minh Phụng' },
          { stt: 2, name: 'Máy vặn vít dùng Pin BOSCH GDR 180-LI', managementCode: 'WH-MVV-001', responsiblePerson: 'Nguyễn Minh Phụng' },
          { stt: 3, name: 'Máy vặn vít dùng Pin BOSCH GDR 180-LI', managementCode: 'WH-MVV-002', responsiblePerson: 'Nguyễn Hoàng Phúc' }
        ]
      }
    ]
  }
];

export function buildSeedEquipment(): Equipment[] {
  const used = new Set<string>();
  const rows: Equipment[] = [];
  SEED_CATEGORIES.forEach(category => {
    category.subcategories.forEach(sub => {
      sub.equipment.forEach(item => {
        let equipmentId = item.managementCode.trim();
        if (used.has(equipmentId)) equipmentId = `${equipmentId}__2`;
        used.add(equipmentId);
        const row: Equipment = {
          equipmentId,
          stt: item.stt,
          categoryId: category.id,
          subcategoryId: sub.id,
          equipmentName: item.name,
          managementCode: item.managementCode.trim(),
          responsiblePerson: item.responsiblePerson,
          responsibleEmployeeId: null,
          frequency: 'daily',
          status: 'ACTIVE'
        };
        if (item.inspectionItems?.length) row.inspectionItems = item.inspectionItems;
        rows.push(row);
      });
    });
  });
  return rows;
}
