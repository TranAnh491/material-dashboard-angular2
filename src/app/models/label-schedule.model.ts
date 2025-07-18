export interface LabelScheduleData {
  id?: string;
  nam: number; // Năm
  thang: number; // Tháng
  stt: number; // STT
  kichThuocKhoi: string; // Kích thước khôi
  maTem: string; // Mã tem
  soLuongYeuCau: number; // Số lượng yêu cầu
  soLuongAuto1: number; // Số lượng (auto) *3 - cột 1
  soLuongAuto2: number; // Số lượng (auto) *3 - cột 2  
  soLuongAuto3: number; // Số lượng (auto) *3 - cột 3
  maSanPham: string; // Mã sản phẩm
  soLenhSanXuat: string; // Số lệnh sản xuất
  khachHang: string; // Khách hàng (auto)
  ngayKhoiTao: Date; // Ngày khởi tạo lệnh gửi
  vt: string; // VT
  hw: string; // HW
  lua: string; // Lửa
  nguoiDi: string; // Người đi
  tinhTrang: string; // Tình trạng
  donVi: string; // Đơn vị
  note: string; // Note
  thoiGianInPhai: Date; // Thời gian in (phải)
  
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