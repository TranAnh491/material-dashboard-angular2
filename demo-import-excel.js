// Demo script để test chức năng import Excel
// Chạy trong browser console sau khi vào trang Materials Inventory

console.log('🚀 Demo Import Excel - Materials Inventory');

// Test file validation
function testFileValidation() {
  console.log('📋 Testing file validation...');
  
  // Mock file object
  const mockFile = {
    name: 'Template_Ton_kho_Factory.xlsx',
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: 1024 * 1024, // 1MB
    lastModified: Date.now()
  };
  
  console.log('Mock file:', mockFile);
  console.log('File size (MB):', mockFile.size / (1024 * 1024));
  
  // Test validation logic
  const allowedTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv'
  ];
  
  const maxSizeMB = 10;
  const fileSizeMB = mockFile.size / (1024 * 1024);
  
  const isValidType = allowedTypes.includes(mockFile.type);
  const isValidSize = fileSizeMB <= maxSizeMB;
  
  console.log('✅ Type valid:', isValidType);
  console.log('✅ Size valid:', isValidSize);
  console.log('✅ Overall valid:', isValidType && isValidSize);
}

// Test batch processing
function testBatchProcessing() {
  console.log('🔄 Testing batch processing...');
  
  const totalItems = 1250;
  const batchSize = 50;
  const batches = Math.ceil(totalItems / batchSize);
  
  console.log(`Total items: ${totalItems}`);
  console.log(`Batch size: ${batchSize}`);
  console.log(`Number of batches: ${batches}`);
  
  // Simulate batch processing
  for (let i = 0; i < batches; i++) {
    const start = i * batchSize;
    const end = Math.min(start + batchSize, totalItems);
    const currentBatch = end - start;
    
    console.log(`Batch ${i + 1}/${batches}: Items ${start + 1}-${end} (${currentBatch} items)`);
  }
}

// Test progress calculation
function testProgressCalculation() {
  console.log('📊 Testing progress calculation...');
  
  const testCases = [
    { current: 0, total: 100 },
    { current: 25, total: 100 },
    { current: 50, total: 100 },
    { current: 75, total: 100 },
    { current: 100, total: 100 },
    { current: 250, total: 1000 },
    { current: 500, total: 1000 },
    { current: 1000, total: 1000 }
  ];
  
  testCases.forEach(({ current, total }) => {
    const percentage = (current / total) * 100;
    console.log(`Progress: ${current}/${total} = ${percentage.toFixed(1)}%`);
  });
}

// Test Excel structure validation
function testExcelStructure() {
  console.log('📝 Testing Excel structure validation...');
  
  const mockExcelData = [
    ['Factory', 'Material Code', 'PO Number', 'Quantity', 'Type', 'Location'], // Header
    ['ASM1', 'MAT001', 'PO001', '100', 'Type1', 'A1'],
    ['ASM2', 'MAT002', 'PO002', '200', 'Type2', 'B2'],
    ['ASM1', 'MAT003', 'PO003', '150', 'Type1', 'C3'],
    ['', 'MAT004', 'PO004', '300', 'Type3', 'D4'], // Invalid: missing factory
    ['ASM2', '', 'PO005', '250', 'Type2', 'E5'],   // Invalid: missing material code
    ['ASM1', 'MAT006', '', '175', 'Type1', 'F6'],  // Invalid: missing PO
    ['ASM2', 'MAT007', 'PO007', '0', 'Type2', 'G7'], // Invalid: quantity = 0
    ['ASM1', 'MAT008', 'PO008', '-50', 'Type1', 'H8'], // Invalid: negative quantity
  ];
  
  console.log('Mock Excel data:');
  mockExcelData.forEach((row, index) => {
    console.log(`Row ${index}:`, row);
  });
  
  // Validate rows
  const validRows = [];
  const invalidRows = [];
  
  for (let i = 1; i < mockExcelData.length; i++) {
    const row = mockExcelData[i];
    const isValid = row[0] && row[1] && row[2] && Number(row[3]) > 0;
    
    if (isValid) {
      validRows.push({ row: i + 1, data: row });
    } else {
      invalidRows.push({ row: i + 1, data: row, reason: getInvalidReason(row) });
    }
  }
  
  console.log('✅ Valid rows:', validRows.length);
  validRows.forEach(item => {
    console.log(`  Row ${item.row}: ${item.data.join(' | ')}`);
  });
  
  console.log('❌ Invalid rows:', invalidRows.length);
  invalidRows.forEach(item => {
    console.log(`  Row ${item.row}: ${item.data.join(' | ')} - ${item.reason}`);
  });
}

function getInvalidReason(row) {
  if (!row[0]) return 'Missing Factory';
  if (!row[1]) return 'Missing Material Code';
  if (!row[2]) return 'Missing PO Number';
  if (Number(row[3]) <= 0) return 'Invalid Quantity';
  return 'Unknown';
}

// Test performance simulation
function testPerformanceSimulation() {
  console.log('⚡ Testing performance simulation...');
  
  const startTime = performance.now();
  
  // Simulate processing 1000 items
  const items = Array.from({ length: 1000 }, (_, i) => ({
    id: i + 1,
    factory: `ASM${(i % 2) + 1}`,
    materialCode: `MAT${String(i + 1).padStart(3, '0')}`,
    poNumber: `PO${String(i + 1).padStart(3, '0')}`,
    quantity: Math.floor(Math.random() * 1000) + 1,
    type: `Type${(i % 5) + 1}`,
    location: String.fromCharCode(65 + (i % 26)) + (i % 10 + 1)
  }));
  
  // Process in batches
  const batchSize = 50;
  const batches = Math.ceil(items.length / batchSize);
  
  let processedItems = 0;
  
  for (let i = 0; i < batches; i++) {
    const batch = items.slice(i * batchSize, (i + 1) * batchSize);
    
    // Simulate batch processing time
    const batchStart = performance.now();
    
    // Process batch (simulate Firebase operations)
    batch.forEach(item => {
      // Simulate validation
      if (!item.materialCode || !item.poNumber || item.quantity <= 0) {
        throw new Error(`Invalid item: ${JSON.stringify(item)}`);
      }
      
      // Simulate duplicate check
      const isDuplicate = Math.random() < 0.05; // 5% chance of duplicate
      
      if (!isDuplicate) {
        processedItems++;
      }
    });
    
    const batchEnd = performance.now();
    const batchTime = batchEnd - batchStart;
    
    console.log(`Batch ${i + 1}/${batches}: ${batch.length} items in ${batchTime.toFixed(2)}ms`);
    
    // Small delay to prevent UI blocking
    if (i < batches - 1) {
      const delay = Math.min(batchTime * 0.1, 100); // 10% of batch time, max 100ms
      console.log(`  Delay: ${delay.toFixed(2)}ms`);
    }
  }
  
  const endTime = performance.now();
  const totalTime = endTime - startTime;
  
  console.log('📊 Performance Results:');
  console.log(`Total items: ${items.length}`);
  console.log(`Processed items: ${processedItems}`);
  console.log(`Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`Average time per item: ${(totalTime / items.length).toFixed(2)}ms`);
  console.log(`Items per second: ${(items.length / (totalTime / 1000)).toFixed(2)}`);
}

// Run all tests
function runAllTests() {
  console.log('🧪 Running all tests...\n');
  
  testFileValidation();
  console.log('');
  
  testBatchProcessing();
  console.log('');
  
  testProgressCalculation();
  console.log('');
  
  testExcelStructure();
  console.log('');
  
  testPerformanceSimulation();
  console.log('');
  
  console.log('✅ All tests completed!');
}

// Export functions for manual testing
window.demoImportExcel = {
  testFileValidation,
  testBatchProcessing,
  testProgressCalculation,
  testExcelStructure,
  testPerformanceSimulation,
  runAllTests
};

console.log('💡 Use demoImportExcel.runAllTests() to run all tests');
console.log('💡 Or run individual tests like demoImportExcel.testFileValidation()');
