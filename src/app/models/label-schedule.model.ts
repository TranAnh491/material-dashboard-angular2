export interface LabelScheduleData {
  id?: string;
  nam: number; // Năm
  thang: number; // Tháng
  stt: number; // STT
  kichThuocKhoi: string; // Kích thước khối
  maTem: string; // Mã tem
  soLuongYeuCau: number; // Số lượng yêu cầu
  soLuongPhoi: number; // Số lượng phôi
  maHang: string; // Mã Hàng
  lenhSanXuat: string; // Lệnh sản xuất
  khachHang: string; // Khách hàng
  ngayNhanKeHoach: Date; // Ngày nhận kế hoạch
  yy: string; // YY
  ww: string; // WW
  lineNhan: string; // Line nhận
  nguoiIn: string; // Người in
  tinhTrang: string; // Tình trạng
  banVe: string; // Bản vẽ
  ghiChu: string; // Ghi chú
  
  // Additional fields for processing
  status?: 'pending' | 'printing' | 'completed' | 'failed';
  progress?: number;
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string;
}

export interface ExcelImportResult {
  success: boolean;
  totalRows: number;
  validRows: number;
  errors: string[];
  data: LabelScheduleData[];
}

export interface LabelScheduleFilter {
  nam?: number;
  thang?: number;
  status?: string;
  khachHang?: string;
  maTem?: string;
  searchTerm?: string;
} 