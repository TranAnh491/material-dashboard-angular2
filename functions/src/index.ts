import * as functions from 'firebase-functions';
import * as nodemailer from 'nodemailer';
import * as admin from 'firebase-admin';

// Khởi tạo Firebase Admin
admin.initializeApp();

// Cấu hình email SMTP
const transporter = nodemailer.createTransporter({
  host: 'smtp.gmail.com', // hoặc SMTP server khác
  port: 587,
  secure: false,
  auth: {
    user: 'airspeedmanufacturing@gmail.com', // Thay bằng email thực
    pass: '@irspeed2017' // Thay bằng app password
  }
});

// Function gửi email report hàng tuần
export const sendWeeklyReport = functions.pubsub
  .schedule('0 9 * * 1') // Mỗi thứ 2 lúc 9h sáng
  .timeZone('Asia/Ho_Chi_Minh')
  .onRun(async (context) => {
    try {
      console.log('📧 Bắt đầu gửi email report hàng tuần...');
      
      // Lấy dữ liệu từ Firestore
      const db = admin.firestore();
      
      // Lấy dữ liệu Inbound
      const inboundSnapshot = await db.collection('inbound-materials').get();
      const inboundData = inboundSnapshot.docs.map(doc => doc.data());
      
      // Lấy dữ liệu Outbound
      const outboundSnapshot = await db.collection('outbound-materials').get();
      const outboundData = outboundSnapshot.docs.map(doc => doc.data());
      
      // Tạo nội dung email
      const emailContent = generateWeeklyReportEmail(inboundData, outboundData);
      
              // Gửi email
        const mailOptions = {
          from: 'airspeedmanufacturing@gmail.com',
          to: 'asm-wh@airspeedmfg.com',
          subject: `📊 Báo cáo hàng tuần - ${new Date().toLocaleDateString('vi-VN')}`,
          html: emailContent
        };
      
      const result = await transporter.sendMail(mailOptions);
      console.log('✅ Email report hàng tuần đã được gửi:', result.messageId);
      
      return { success: true, messageId: result.messageId };
      
    } catch (error) {
      console.error('❌ Lỗi gửi email report hàng tuần:', error);
      throw error;
    }
  });

// Function gửi email report theo yêu cầu
export const sendReportEmail = functions.https.onCall(async (data, context) => {
  try {
    const { reportType, startDate, endDate, emailData } = data;
    
    // Tạo nội dung email
    const emailContent = generateCustomReportEmail(reportType, emailData);
    
          const mailOptions = {
        from: 'airspeedmanufacturing@gmail.com',
        to: 'asm-wh@airspeedmfg.com',
        subject: `📊 Báo cáo ${reportType} - ${startDate} đến ${endDate}`,
        html: emailContent
      };
    
    const result = await transporter.sendMail(mailOptions);
    return { success: true, messageId: result.messageId };
    
  } catch (error) {
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// Tạo nội dung email report hàng tuần
function generateWeeklyReportEmail(inboundData: any[], outboundData: any[]): string {
  const currentDate = new Date();
  const weekStart = new Date(currentDate);
  weekStart.setDate(currentDate.getDate() - currentDate.getDay() + 1);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  
  // Thống kê Inbound
  const inboundStats = {
    total: inboundData.length,
    received: inboundData.filter(item => item.isReceived).length,
    pending: inboundData.filter(item => !item.isReceived).length,
    completed: inboundData.filter(item => item.isCompleted).length
  };
  
  // Thống kê Outbound
  const outboundStats = {
    total: outboundData.length,
    completed: outboundData.filter(item => item.isCompleted).length,
    pending: outboundData.filter(item => !item.isCompleted).length
  };
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f0f0f0; padding: 20px; border-radius: 8px; }
        .section { margin: 20px 0; padding: 15px; border-left: 4px solid #007bff; }
        .stats { display: flex; gap: 20px; margin: 15px 0; }
        .stat-box { background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center; }
        .stat-number { font-size: 24px; font-weight: bold; color: #007bff; }
        .stat-label { color: #6c757d; margin-top: 5px; }
        .table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        .table th, .table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        .table th { background: #f8f9fa; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>📊 Báo cáo hàng tuần</h1>
        <p><strong>Tuần:</strong> ${weekStart.toLocaleDateString('vi-VN')} - ${weekEnd.toLocaleDateString('vi-VN')}</p>
        <p><strong>Ngày tạo:</strong> ${currentDate.toLocaleDateString('vi-VN')} ${currentDate.toLocaleTimeString('vi-VN')}</p>
      </div>
      
      <div class="section">
        <h2>📦 Thống kê Inbound</h2>
        <div class="stats">
          <div class="stat-box">
            <div class="stat-number">${inboundStats.total}</div>
            <div class="stat-label">Tổng cộng</div>
          </div>
          <div class="stat-box">
            <div class="stat-number">${inboundStats.received}</div>
            <div class="stat-label">Đã nhận</div>
          </div>
          <div class="stat-box">
            <div class="stat-number">${inboundStats.pending}</div>
            <div class="stat-label">Chờ xử lý</div>
          </div>
          <div class="stat-box">
            <div class="stat-number">${inboundStats.completed}</div>
            <div class="stat-label">Hoàn thành</div>
          </div>
        </div>
      </div>
      
      <div class="section">
        <h2>🚀 Thống kê Outbound</h2>
        <div class="stats">
          <div class="stat-box">
            <div class="stat-number">${outboundStats.total}</div>
            <div class="stat-label">Tổng cộng</div>
          </div>
          <div class="stat-box">
            <div class="stat-number">${outboundStats.completed}</div>
            <div class="stat-label">Hoàn thành</div>
          </div>
          <div class="stat-box">
            <div class="stat-number">${outboundStats.pending}</div>
            <div class="stat-label">Chờ xử lý</div>
          </div>
        </div>
      </div>
      
      <div class="section">
        <h2>📋 Chi tiết Inbound gần đây</h2>
        <table class="table">
          <thead>
            <tr>
              <th>Mã hàng</th>
              <th>Lô hàng</th>
              <th>Trạng thái</th>
              <th>Ngày tạo</th>
            </tr>
          </thead>
          <tbody>
            ${inboundData.slice(0, 10).map(item => `
              <tr>
                <td>${item.materialCode || 'N/A'}</td>
                <td>${item.batchNumber || 'N/A'}</td>
                <td>${item.isReceived ? '✅ Đã nhận' : '⏳ Chờ xử lý'}</td>
                <td>${item.createdAt ? new Date(item.createdAt.toDate()).toLocaleDateString('vi-VN') : 'N/A'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      
      <div class="section">
        <h2>📋 Chi tiết Outbound gần đây</h2>
        <table class="table">
          <thead>
            <tr>
              <th>Mã hàng</th>
              <th>Lô hàng</th>
              <th>Trạng thái</th>
              <th>Ngày tạo</th>
            </tr>
          </thead>
          <tbody>
            ${outboundData.slice(0, 10).map(item => `
              <tr>
                <td>${item.materialCode || 'N/A'}</td>
                <td>${item.batchNumber || 'N/A'}</td>
                <td>${item.isCompleted ? '✅ Hoàn thành' : '⏳ Chờ xử lý'}</td>
                <td>${item.createdAt ? new Date(item.createdAt.toDate()).toLocaleDateString('vi-VN') : 'N/A'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      
      <div class="section">
        <p><em>📧 Email này được gửi tự động từ hệ thống quản lý kho Airspeed Manufacturing.</em></p>
        <p><em>Nếu có vấn đề, vui lòng liên hệ IT Support.</em></p>
      </div>
    </body>
    </html>
  `;
}

// Tạo nội dung email report tùy chỉnh
function generateCustomReportEmail(reportType: string, emailData: any[]): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f0f0f0; padding: 20px; border-radius: 8px; }
        .section { margin: 20px 0; padding: 15px; border-left: 4px solid #007bff; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>📊 Báo cáo ${reportType}</h1>
        <p><strong>Ngày tạo:</strong> ${new Date().toLocaleDateString('vi-VN')}</p>
      </div>
      
      <div class="section">
        <h2>📋 Dữ liệu báo cáo</h2>
        <p>Số lượng bản ghi: ${emailData.length}</p>
        <!-- Thêm nội dung báo cáo tùy chỉnh ở đây -->
      </div>
      
      <div class="section">
        <p><em>📧 Email này được gửi tự động từ hệ thống quản lý kho Airspeed Manufacturing.</em></p>
      </div>
    </body>
    </html>
  `;
}
