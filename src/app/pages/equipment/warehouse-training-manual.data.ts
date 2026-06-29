export interface ManualTocSection {
  title: string;
  items: string[];
}

export interface ManualStep {
  number: number;
  title: string;
  performer?: string;
  tasks?: string[];
  checks?: string[];
  observes?: string[];
  cases?: { label: string; detail: string }[];
  flow?: string[];
  note?: string;
  why?: { title: string; items: string[] };
  rules?: string[];
  forbidden?: string[];
}

export interface ManualQuizQuestion {
  number: number;
  question: string;
  options: string[];
}

export interface ManualPage {
  pageNum: number;
  partLabel?: string;
  chapterLabel?: string;
  title: string;
  subtitle?: string;
  type: 'toc' | 'flow' | 'chapter';
  toc?: ManualTocSection[];
  flow?: string[];
  goals?: string[];
  steps?: ManualStep[];
  rules?: string[];
  errors?: string[];
  forbidden?: string[];
  checks?: string[];
  flowSections?: { title: string; flow: string[] }[];
  questions?: ManualQuizQuestion[];
}

export const MANUAL_DOC_META = {
  docCode: 'WH-WI0005/DT',
  version: '00',
  issueDate: '05/03/2026',
  companyLine1: 'AIRSPEED MANUFACTURING VIET NAM',
  manualTitle: 'TÀI LIỆU HƯỚNG DẪN ĐÀO TẠO KHO',
  formTitle: 'BIỂU MẪU ĐÀO TẠO NHÂN VIÊN KHO ( Ngày Đầu)',
  quizTitle: 'BIỂU MẪU CÂU HỎI ĐÀO TẠO'
};

export const WAREHOUSE_TRAINING_MANUAL_PAGES: ManualPage[] = [
  {
    pageNum: 1,
    title: 'MỤC LỤC',
    type: 'toc',
    toc: [
      {
        title: 'PHẦN I. NHẬP - XUẤT KHO NGUYÊN VẬT LIỆU',
        items: [
          'Tổng quan quy trình',
          'Nhập kho nguyên vật liệu',
          'Xuất kho nguyên vật liệu'
        ]
      },
      {
        title: 'PHẦN II. NHẬP - XUẤT KHO THÀNH PHẨM',
        items: [
          'Tổng quan quy trình',
          'Nhập kho thành phẩm',
          'Xuất kho thành phẩm',
          'Giao hàng'
        ]
      }
    ]
  },
  {
    pageNum: 2,
    partLabel: 'PHẦN I',
    chapterLabel: 'KHO NGUYÊN VẬT LIỆU — Chương 1',
    title: 'Quy trình tổng quát',
    type: 'flow',
    flow: [
      'Xe đến',
      'Tiếp nhận',
      'Kiểm tra ngoại quan',
      'Kiểm tra số lượng',
      'Đối chiếu chứng từ',
      'In QR',
      'IQC',
      'PASS',
      'Lưu kho',
      'Nhận yêu cầu xuất',
      'Soạn hàng',
      'Scan QR',
      'Giao sản xuất'
    ]
  },
  {
    pageNum: 3,
    partLabel: 'PHẦN I',
    chapterLabel: 'Chương 2',
    title: 'NHẬP KHO NGUYÊN VẬT LIỆU',
    type: 'chapter',
    goals: [
      'Đúng hàng',
      'Đúng số lượng',
      'Đúng PO',
      'Đúng Lot',
      'Đúng HSD',
      'Không nhận hàng lỗi'
    ],
    steps: [
      {
        number: 1,
        title: 'Tiếp nhận xe',
        performer: 'Công nhân kho',
        tasks: [
          'Hướng dẫn xe vào đúng vị trí',
          'Quan sát tình trạng xe',
          'Đảm bảo khu vực an toàn'
        ],
        note: 'Không tự ý cho xe vào kho.'
      },
      {
        number: 2,
        title: 'Nhận chứng từ',
        cases: [
          { label: 'Hàng nhập khẩu', detail: 'Nhận danh sách từ nhân viên kho.' },
          { label: 'Hàng nội địa', detail: 'Nhận Packing List từ nhà cung cấp.' },
          { label: 'Hàng trả sản xuất', detail: 'Nhận phiếu trả vật tư.' }
        ]
      }
    ]
  },
  {
    pageNum: 4,
    partLabel: 'PHẦN I',
    chapterLabel: 'Chương 2 (tiếp)',
    title: 'NHẬP KHO NGUYÊN VẬT LIỆU',
    type: 'chapter',
    steps: [
      {
        number: 3,
        title: 'Kiểm tra ngoại quan',
        checks: ['Carton', 'Bao PE', 'Tem', 'Pallet', 'Dây đai'],
        observes: ['Móp', 'Rách', 'Ướt', 'Dầu', 'Biến dạng'],
        flow: ['Không dỡ hàng', 'Chụp hình', 'Báo quản lý', 'Lập biên bản'],
        why: {
          title: 'Tại sao?',
          items: ['Nhà cung cấp', 'Đơn vị vận chuyển', 'Công ty']
        }
      },
      {
        number: 4,
        title: 'Hàng nghi ngờ',
        tasks: [
          'Có mùi',
          'Có nước rỉ',
          'Không rõ người gửi',
          'Có âm thanh',
          'Bao bì bất thường'
        ],
        flow: ['Không mở', 'Đưa Isolation', 'Báo quản lý']
      }
    ]
  },
  {
    pageNum: 5,
    partLabel: 'PHẦN I',
    chapterLabel: 'Chương 2 (tiếp)',
    title: 'NHẬP KHO NGUYÊN VẬT LIỆU',
    type: 'chapter',
    steps: [
      {
        number: 5,
        title: 'Kiểm số kiện',
        tasks: ['Bao nhiêu carton', 'Bao nhiêu pallet'],
        note: 'Không mở từng thùng.',
        checks: ['Tổng thể', 'Tem', 'Số kiện']
      },
      {
        number: 6,
        title: 'Đối chiếu',
        checks: ['PO', 'Mã hàng', 'Lot', 'HSD', 'Số lượng'],
        flow: ['Cân', 'Đếm', 'Đo mét']
      },
      {
        number: 7,
        title: 'In QR',
        flow: ['In QR', 'Dán QR', 'Nhập hệ thống']
      }
    ]
  },
  {
    pageNum: 6,
    partLabel: 'PHẦN I',
    chapterLabel: 'Chương 2 (tiếp)',
    title: 'NHẬP KHO NGUYÊN VẬT LIỆU',
    type: 'chapter',
    steps: [
      {
        number: 8,
        title: 'Chờ IQC',
        checks: ['PASS', 'NG', 'Đặc cách', 'Chờ phán định']
      },
      {
        number: 9,
        title: 'Lưu kho',
        flow: ['Scan vị trí', 'Đưa lên kệ', 'Cập nhật hệ thống'],
        rules: [
          'Hàng nặng dưới → Hàng nhẹ trên',
          'Không quá tải',
          'Không nghiêng pallet',
          'Không che PCCC'
        ]
      }
    ],
    errors: [
      'Không chụp hình',
      'Không kiểm HSD',
      'Dán sai QR',
      'Đặt sai vị trí',
      'Nhập nhầm Lot'
    ]
  },
  {
    pageNum: 7,
    partLabel: 'PHẦN I',
    chapterLabel: 'Chương 3',
    title: 'XUẤT NGUYÊN VẬT LIỆU',
    type: 'chapter',
    goals: ['FIFO', 'Mã hàng', 'Lot', 'PO', 'Số lượng'],
    steps: [
      {
        number: 1,
        title: 'Nhận yêu cầu xuất',
        flow: ['Tạo phiếu xuất', 'In danh sách', 'Giao công nhân'],
        performer: 'Nhân viên kho'
      },
      {
        number: 2,
        title: 'Soạn hàng',
        flow: ['Đến đúng vị trí', 'Kiểm QR', 'Lot', 'PO', 'Mã hàng', 'Số lượng']
      },
      {
        number: 3,
        title: 'Scan QR',
        flow: ['Scan', 'Xác nhận', 'Đưa hàng xuống']
      },
      {
        number: 4,
        title: 'Vật tư lẻ',
        note: 'Nếu cắt',
        flow: ['Cân', 'Dán PASS', 'IQC xác nhận']
      },
      {
        number: 5,
        title: 'Giao sản xuất',
        flow: ['Đưa hàng', 'Khu chờ', 'Line sản xuất'],
        forbidden: ['NG', 'CXL', 'EOL', 'Chưa PASS']
      }
    ],
    errors: ['Sai FIFO', 'Sai Lot', 'Sai QR', 'Sai PO', 'Không cân vật tư lẻ']
  },
  {
    pageNum: 8,
    partLabel: 'PHẦN II',
    chapterLabel: 'KHO THÀNH PHẨM — Chương 4',
    title: 'Quy trình tổng quát',
    type: 'flow',
    flow: [
      'Nhận TP',
      'Scan',
      'Lưu kho',
      'Shipment',
      'Soạn hàng',
      'Đóng gói',
      'Dán PO',
      'Dán tem khách',
      'Đóng pallet',
      'QC',
      'Đai',
      'Quấn PE',
      'Dán Label',
      'Chờ xuất',
      'Xe đến',
      'Xuất hàng'
    ]
  },
  {
    pageNum: 9,
    partLabel: 'PHẦN II',
    chapterLabel: 'Chương 5',
    title: 'NHẬP THÀNH PHẨM',
    type: 'chapter',
    goals: ['Mã hàng', 'LSX', 'Vị trí', 'QR'],
    steps: [
      {
        number: 1,
        title: 'Nhận & nhập kho',
        flow: ['Nhận phiếu cân', 'Đối chiếu LinkQ', 'Scan', 'Nhập']
      },
      {
        number: 2,
        title: 'Tem đỏ',
        flow: ['Kiểm NG hay Cách ly']
      },
      {
        number: 3,
        title: 'Lưu kho',
        flow: ['Nhiều thùng → Pallet → Quấn PE → QR pallet', 'Ít thùng → Đưa lên kệ']
      }
    ],
    rules: ['Tem quay ngoài', 'Một mã — Một vị trí — Một lot — Một thùng lẻ'],
    errors: ['Đặt sai vị trí', 'Không scan', 'Tem quay vào trong']
  },
  {
    pageNum: 10,
    partLabel: 'PHẦN II',
    chapterLabel: 'Chương 6',
    title: 'XUẤT THÀNH PHẨM',
    type: 'chapter',
    steps: [
      {
        number: 1,
        title: 'Nhận Shipment',
        flow: ['Packing List', 'Soạn hàng']
      },
      {
        number: 2,
        title: 'Kiểm hàng',
        checks: ['PO', 'Lot', 'LSX', 'Mã hàng'],
        flow: ['Đưa sang đóng gói']
      },
      {
        number: 3,
        title: 'Tách hàng',
        flow: ['In tem mới', 'QC', 'Đóng dấu']
      },
      {
        number: 4,
        title: 'Dán nhãn',
        flow: ['PO', 'Tem khách', 'UL']
      },
      {
        number: 5,
        title: 'Đóng pallet',
        flow: ['Hàng nặng dưới', 'Hàng nhẹ trên', 'Đai', 'PE', 'Label']
      }
    ],
    errors: ['Sai PO', 'Sai tem', 'Sai Label', 'Sai UL', 'Pallet lệch']
  },
  {
    pageNum: 11,
    partLabel: 'PHẦN II',
    chapterLabel: 'Chương 7',
    title: 'GIAO HÀNG',
    type: 'chapter',
    flowSections: [
      {
        title: 'Kiểm tra xe',
        flow: ['Biển số', 'Tài xế', 'Container', 'Seal', 'Booking']
      },
      {
        title: 'Xuất hàng',
        flow: ['Scan pallet', 'Đưa lên xe', 'Chụp hình', 'Tài xế ký', 'Xe rời công ty']
      }
    ]
  }
];
