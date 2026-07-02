import { MANUAL_DOC_META } from './warehouse-training-manual.data';

export interface QuizQuestion {
  number: number;
  question: string;
  options: string[];
  /** Index đáp án đúng (0=A, 1=B, …). Mặc định 1 (B). */
  correctIndex?: number;
}

export interface QuizSection {
  id: string;
  title: string;
  questions: QuizQuestion[];
}

export const WAREHOUSE_QUIZ_SECTIONS: QuizSection[] = [
  {
    id: 'nvl-in',
    title: 'Nhập nguyên vật liệu',
    questions: [
      {
        number: 1,
        question: 'Khi phát hiện hàng ngoại quan bất thường (móp, rách, ướt), cần làm gì đầu tiên?',
        options: ['Dỡ hàng ngay', 'Không dỡ hàng, chụp hình và báo quản lý', 'Nhập kho tạm', 'Tự xử lý']
      },
      {
        number: 2,
        question: 'Khi nhập kho NVL, cần đối chiếu những thông tin nào?',
        options: ['Chỉ mã hàng', 'PO, mã hàng, Lot, HSD, số lượng', 'Chỉ số lượng', 'Chỉ PO']
      },
      {
        number: 3,
        question: 'Trước khi lưu kho hàng PASS, thứ tự đúng là gì?',
        options: ['Đưa lên kệ rồi scan', 'Scan vị trí → đưa lên kệ → cập nhật hệ thống', 'Chỉ cập nhật hệ thống', 'Chỉ dán QR']
      },
      {
        number: 4,
        question: 'Kết quả IQC có thể là những trạng thái nào?',
        options: ['PASS và NG', 'PASS, NG, Đặc cách, Chờ phán định', 'Chỉ PASS', 'OK và Not OK']
      },
      {
        number: 5,
        question: 'Nếu có người lạ , không mang đồng phục, thẻ nhân viên vào Kho lấy hàng, bạn cần làm gì',
        options: ['Không quan tâm', 'Báo quản lý hoặc bảo vệ', 'Chỉ nhìn', 'Tươi cười nói chuyện'],
        correctIndex: 1
      },
      {
        number: 6,
        question: 'Khi xe hàng đến cổng, công nhân kho cần làm gì trước khi dỡ hàng?',
        options: [
          'Kiểm tra phiếu giao hàng xem có Mã hàng , PO, Số lượng không ?',
          'Kiểm tra ngoại quan, chụp hình, báo quản lý',
          'Ký nhận trước rồi dỡ',
          'Chỉ kiểm số lượng'
        ],
        correctIndex: 0
      },
      {
        number: 7,
        question: 'Quy định xếp pallet đúng là gì?',
        options: ['Hàng nặng trên, nhẹ dưới', 'Hàng nặng dưới, nhẹ trên, không quá tải, không che PCCC', 'Xếp tùy tiện miễn gọn', 'Chỉ cần không đổ']
      },
      {
        number: 8,
        question: 'Hàng IQC chờ phán định được phép làm gì?',
        options: ['Nhập vị trí hàng PASS', 'Để khu vực chờ, không mix với hàng PASS', 'Xuất cho sản xuất', 'Dán tem PASS tạm']
      }
    ]
  },
  {
    id: 'nvl-out',
    title: 'Xuất nguyên vật liệu',
    questions: [
      {
        number: 1,
        question: 'Nguyên tắc FIFO trong xuất kho nghĩa là gì?',
        options: ['Xuất hàng mới trước', 'Xuất hàng nhập trước, xuất trước', 'Xuất theo vị trí gần', 'Xuất tùy ý']
      },
      {
        number: 2,
        question: 'Hàng NG, CXL, EOL hoặc chưa PASS có được xuất cho sản xuất không?',
        options: ['Được nếu thiếu', 'Không được xuất', 'Được khi công nhân xác nhận', 'Được trường hợp khẩn']
      },
      {
        number: 3,
        question: 'Khi xuất vật tư lẻ đã cắt, cần làm gì?',
        options: ['Xuất luôn', 'Cân → dán PASS → IQC xác nhận', 'Chỉ cân', 'Chỉ dán tem']
      },
      {
        number: 4,
        question: 'Trước khi xuất NVL theo lệnh sản xuất, cần kiểm tra gì?',
        options: ['Chỉ mã hàng', 'Mã hàng, Lot, vị trí, trạng thái PASS', 'Chỉ Lot', 'Chỉ số lượng']
      },
      {
        number: 5,
        question: 'Khi scan xuất kho phát hiện sai Lot so với yêu cầu, xử lý thế nào?',
        options: ['Xuất luôn nếu đúng mã', 'Dừng xuất, báo quản lý', 'Đổi Lot trên hệ thống', 'Lấy Lot khác không báo']
      },
      {
        number: 6,
        question: 'Hàng gần hết hạn (HSD) khi xuất kho nên ưu tiên thế nào?',
        options: ['Xuất sau cùng', 'Xuất trước theo FIFO/FEFO', 'Tùy công nhân chọn', 'Để lại kho']
      },
      {
        number: 7,
        question: 'Sau khi lấy hàng xuất, vị trí kho cần cập nhật thế nào?',
        options: ['Không cần cập nhật', 'Scan xác nhận xuất và cập nhật tồn hệ thống', 'Chỉ ghi sổ tay', 'Chờ cuối ngày mới cập nhật']
      },
      {
        number: 8,
        question: 'Khi thiếu hàng so với yêu cầu xuất, công nhân kho làm gì?',
        options: ['Lấy hàng khác thay thế tùy ý', 'Báo quản lý, không tự ý thay thế', 'Xuất thiếu không báo', 'Hủy lệnh xuất']
      }
    ]
  },
  {
    id: 'fg-in',
    title: 'Nhập thành phẩm',
    questions: [
      {
        number: 1,
        question: 'Khi nhập TP, cần đối chiếu thông tin nào?',
        options: ['Chỉ mã hàng', 'Mã hàng, LSX, vị trí, QR', 'Chỉ LSX', 'Chỉ vị trí']
      },
      {
        number: 2,
        question: 'Gặp tem đỏ khi nhập TP cần xử lý thế nào?',
        options: ['Nhập kho bình thường', 'Kiểm NG hay cách ly', 'Bỏ qua', 'Dán tem mới']
      },
      {
        number: 3,
        question: 'Quy định hướng tem khi lưu TP là gì?',
        options: ['Tem quay vào trong', 'Tem quay ra ngoài', 'Không quan trọng', 'Tùy vị trí']
      },
      {
        number: 4,
        question: 'Thành phẩm chưa qua QC có được nhập kho vị trí chính thức không?',
        options: ['Được nếu gấp', 'Không, chờ kết quả QC/PASS', 'Được khi sản xuất xác nhận', 'Được nhập tạm không cần báo']
      },
      {
        number: 5,
        question: 'Khi scan QR nhập TP không khớp hệ thống, xử lý thế nào?',
        options: ['Nhập tạm rồi sửa sau', 'Dừng thao tác, báo quản lý', 'Đổi QR trên hàng', 'Bỏ qua nếu đúng mã']
      },
      {
        number: 6,
        question: 'Pallet TP khi lưu kho cần đảm bảo điều gì?',
        options: ['Chỉ cần gọn', 'Đúng vị trí, không chèn ép, tem hướng ra ngoài', 'Xếp chồng không giới hạn', 'Để sát cửa kho']
      },
      {
        number: 7,
        question: 'Hàng TP NG sau kiểm tra được đưa đi đâu?',
        options: ['Khu vực hàng PASS', 'Khu vực NG / cách ly', 'Xuất ngay', 'Trộn với hàng chờ']
      },
      {
        number: 8,
        question: 'Sau khi nhập TP lên kệ, bước cuối trên hệ thống là gì?',
        options: ['Không cần thao tác', 'Xác nhận nhập kho, cập nhật tồn đúng vị trí', 'Chỉ chụp hình', 'Chỉ in tem']
      }
    ]
  },
  {
    id: 'fg-out',
    title: 'Xuất thành phẩm',
    questions: [
      {
        number: 1,
        question: 'Trước khi đóng gói xuất TP, cần kiểm những gì?',
        options: ['Chỉ mã hàng', 'PO, Lot, LSX, mã hàng', 'Chỉ PO', 'Chỉ tem khách']
      },
      {
        number: 2,
        question: 'Khi đóng pallet xuất TP, quy tắc xếp hàng là gì?',
        options: ['Hàng nặng trên', 'Hàng nặng dưới, nhẹ trên', 'Xếp tùy ý', 'Chỉ cần chắc']
      },
      {
        number: 3,
        question: 'Bước cuối khi giao hàng trước khi xe rời công ty?',
        options: ['Chụp hình', 'Scan pallet, đưa lên xe, chụp hình, tài xế ký', 'Chỉ đưa hàng lên xe', 'Chỉ tài xế ký']
      },
      {
        number: 4,
        question: 'Tem khách hàng trên TP khi xuất cần kiểm tra gì?',
        options: ['Không cần kiểm', 'Đúng mã, Lot, thông tin PO theo yêu cầu', 'Chỉ cần có tem', 'Chỉ kiểm màu tem']
      },
      {
        number: 5,
        question: 'Hàng TP chưa PASS có được đóng gói xuất không?',
        options: ['Được nếu thiếu hàng', 'Không được xuất', 'Được khi khách đồng ý', 'Được trong trường hợp gấp']
      },
      {
        number: 6,
        question: 'Khi đóng gói phát hiện thiếu số lượng so với lệnh xuất?',
        options: ['Đóng gói thiếu không báo', 'Báo quản lý, không tự ý bù sai', 'Lấy hàng khác không kiểm', 'Hủy toàn bộ lô']
      },
      {
        number: 7,
        question: 'Ảnh chụp pallet xuất hàng dùng để làm gì?',
        options: ['Lưu làm kỷ niệm', 'Làm bằng chứng giao hàng, đối chiếu khi cần', 'Không cần chụp', 'Chỉ gửi cho tài xế']
      },
      {
        number: 8,
        question: 'Sau khi hàng lên xe, chứng từ giao hàng cần ai ký?',
        options: ['Chỉ quản lý kho', 'Tài xế / người nhận hàng ký xác nhận', 'Không cần ký', 'Chỉ bảo vệ']
      }
    ]
  }
];

export const QUIZ_DOC_META = {
  ...MANUAL_DOC_META,
  docCode: 'WH-WI0034/F03',
  version: '03',
  issueDate: '02/07/2026',
  quizTitle: 'KIỂM TRA ĐÀO TẠO KHO',
  quizSubtitle: 'Biểu mẫu câu hỏi đào tạo — 4 phần'
};
