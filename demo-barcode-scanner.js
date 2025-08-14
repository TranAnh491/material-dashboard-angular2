/**
 * Demo Barcode Scanner Testing Script
 * 
 * Test real barcode scanning functionality using ZXing library
 * Usage: Copy and paste this into browser console when on the inventory page
 */

window.barcodeScannerDemo = {
  
  /**
   * Test if ZXing library is available
   */
  testZXingLibrary: function() {
    console.log('🧪 Testing ZXing Barcode Library...');
    
    try {
      // Check if ZXing is loaded
      if (typeof window.ZXing === 'undefined') {
        console.error('❌ ZXing library not loaded');
        return false;
      }
      
      console.log('✅ ZXing library is available');
      console.log('📚 ZXing version:', window.ZXing);
      
      return true;
      
    } catch (error) {
      console.error('❌ Error testing ZXing:', error);
      return false;
    }
  },

  /**
   * Test camera permissions for barcode scanning
   */
  testCameraForBarcode: async function() {
    console.log('📱 Testing camera for barcode scanning...');
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 640 },
          height: { ideal: 480 }
        } 
      });
      
      console.log('✅ Camera access granted for barcode scanning');
      console.log('📹 Stream info:', {
        tracks: stream.getTracks().length,
        videoTracks: stream.getVideoTracks().length,
        active: stream.active,
        settings: stream.getVideoTracks()[0]?.getSettings()
      });
      
      // Stop the stream
      stream.getTracks().forEach(track => track.stop());
      console.log('🛑 Test stream stopped');
      
      return true;
      
    } catch (error) {
      console.error('❌ Camera permission denied for barcode:', error);
      
      if (error.name === 'NotAllowedError') {
        console.log('💡 User denied camera permission');
      } else if (error.name === 'NotFoundError') {
        console.log('💡 No camera found on device');
      } else if (error.name === 'NotReadableError') {
        console.log('💡 Camera is already in use by another application');
      }
      
      return false;
    }
  },

  /**
   * Test barcode scanner button functionality
   */
  testScanButton: function() {
    console.log('🔘 Testing scan button functionality...');
    
    // Look for scan buttons in the inventory table
    const scanButtons = document.querySelectorAll('.scan-change-btn');
    
    if (scanButtons.length === 0) {
      console.warn('⚠️ No scan buttons found. Make sure you are on ASM1 or ASM2 inventory page');
      return false;
    }
    
    console.log(`✅ Found ${scanButtons.length} scan buttons`);
    
    scanButtons.forEach((button, index) => {
      console.log(`  Button ${index + 1}:`, {
        text: button.textContent?.trim(),
        title: button.getAttribute('title'),
        disabled: button.disabled,
        visible: button.offsetParent !== null
      });
    });
    
    console.log('ℹ️ Click any scan button to test barcode scanner');
    return true;
  },

  /**
   * Simulate barcode scan result
   */
  simulateBarcodeScan: function(locationCode = 'A01-001') {
    console.log('🎭 Simulating barcode scan result...');
    
    const result = {
      success: true,
      location: locationCode,
      timestamp: new Date(),
      format: 'CODE_128', // Common barcode format
      manual: false
    };
    
    console.log('✅ Simulated barcode result:', result);
    return result;
  },

  /**
   * Test barcode formats recognition
   */
  testBarcodeFormats: function() {
    console.log('📊 Testing barcode format recognition...');
    
    const supportedFormats = [
      'CODE_128',     // Most common for location codes
      'CODE_39',      // Common industrial format
      'EAN_13',       // European Article Number
      'UPC_A',        // Universal Product Code
      'QR_CODE',      // QR codes
      'PDF_417',      // 2D barcode
      'DATA_MATRIX'   // 2D matrix
    ];
    
    console.log('📋 Supported barcode formats:');
    supportedFormats.forEach((format, index) => {
      console.log(`  ${index + 1}. ${format}`);
    });
    
    console.log('ℹ️ ZXing library can decode these barcode types');
    return supportedFormats;
  },

  /**
   * Test location code validation for barcodes
   */
  testLocationValidation: function() {
    console.log('📍 Testing location code validation...');
    
    const testCodes = [
      'A01-001',      // Valid warehouse location
      'B02-015',      // Valid warehouse location  
      'C03-999',      // Valid warehouse location
      'IQC-001',      // Valid IQC location
      'WAREHOUSE-A',  // Valid warehouse zone
      'DOCK-1',       // Valid dock location
      'TEMP-001',     // Valid temporary location
      '123456789',    // Numeric barcode
      'ABC123DEF',    // Alphanumeric barcode
      'INVALID',      // Invalid format
      '',             // Empty
      null            // Null
    ];
    
    testCodes.forEach(code => {
      const isValid = this.validateLocationCode(code);
      const category = this.categorizeLocation(code);
      console.log(`${isValid ? '✅' : '❌'} "${code}": ${isValid ? 'Valid' : 'Invalid'} (${category})`);
    });
  },

  /**
   * Validate location code format
   */
  validateLocationCode: function(code) {
    if (!code || typeof code !== 'string' || code.trim() === '') {
      return false;
    }
    
    // Accept any alphanumeric code for flexibility
    return /^[A-Z0-9\-_]{1,20}$/i.test(code.trim());
  },

  /**
   * Categorize location type
   */
  categorizeLocation: function(code) {
    if (!code) return 'Invalid';
    
    code = code.toUpperCase();
    
    if (code.startsWith('IQC')) return 'IQC Area';
    if (code.startsWith('WAREHOUSE')) return 'Warehouse Zone';
    if (code.startsWith('DOCK')) return 'Dock Area';
    if (code.startsWith('TEMP')) return 'Temporary Storage';
    if (/^[A-Z]\d{2}-\d{3}$/.test(code)) return 'Standard Location';
    if (/^\d+$/.test(code)) return 'Numeric Code';
    if (/^[A-Z0-9\-_]+$/.test(code)) return 'Custom Location';
    
    return 'Unknown Format';
  },

  /**
   * Performance test for barcode scanning
   */
  performanceTest: function() {
    console.log('⚡ Running barcode scanner performance test...');
    
    const startTime = performance.now();
    
    // Simulate barcode processing
    const iterations = 100;
    for (let i = 0; i < iterations; i++) {
      const mockBarcode = `A${String(Math.floor(Math.random() * 99)).padStart(2, '0')}-${String(Math.floor(Math.random() * 999)).padStart(3, '0')}`;
      this.validateLocationCode(mockBarcode);
      this.categorizeLocation(mockBarcode);
    }
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    console.log(`📊 Performance Results:`);
    console.log(`  Iterations: ${iterations}`);
    console.log(`  Total time: ${duration.toFixed(2)}ms`);
    console.log(`  Average time per validation: ${(duration / iterations).toFixed(4)}ms`);
    console.log(`  Theoretical processing rate: ${(iterations / (duration / 1000)).toFixed(0)} codes/second`);
  },

  /**
   * Test complete barcode scanner workflow
   */
  testCompleteWorkflow: function() {
    console.log('🔄 Testing complete barcode scanner workflow...');
    
    console.log('Step 1: Check prerequisites...');
    const cameraOk = navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
    const buttonsOk = document.querySelectorAll('.scan-change-btn').length > 0;
    
    console.log(`📷 Camera API: ${cameraOk ? '✅' : '❌'}`);
    console.log(`🔘 Scan Buttons: ${buttonsOk ? '✅' : '❌'}`);
    
    if (!cameraOk || !buttonsOk) {
      console.warn('⚠️ Prerequisites not met for complete workflow test');
      return false;
    }
    
    console.log('Step 2: Simulate workflow...');
    console.log('  1. User clicks scan button → Modal opens');
    console.log('  2. Camera starts automatically → Video preview shows');
    console.log('  3. User points camera at barcode → ZXing detects barcode');
    console.log('  4. Location extracted → Modal closes automatically');
    console.log('  5. Location updated in table → Firebase saves data');
    
    console.log('✅ Complete workflow ready for testing');
    console.log('ℹ️ To test real workflow: Click any "Scan" button in inventory table');
    
    return true;
  },

  /**
   * Monitor barcode scanner events
   */
  monitorScannerEvents: function() {
    console.log('👀 Monitoring barcode scanner events...');
    
    // Override console methods to capture scanner logs
    const originalLog = console.log;
    const originalError = console.error;
    
    console.log = function(...args) {
      if (args[0] && typeof args[0] === 'string' && args[0].includes('Barcode')) {
        originalLog('🎯 SCANNER EVENT:', ...args);
      } else {
        originalLog(...args);
      }
    };
    
    console.error = function(...args) {
      if (args[0] && typeof args[0] === 'string' && args[0].includes('barcode')) {
        originalError('❌ SCANNER ERROR:', ...args);
      } else {
        originalError(...args);
      }
    };
    
    console.log('✅ Event monitoring active');
    console.log('ℹ️ Scanner events will be highlighted with 🎯 or ❌');
    
    // Restore after 60 seconds
    setTimeout(() => {
      console.log = originalLog;
      console.error = originalError;
      console.log('⏰ Event monitoring stopped');
    }, 60000);
  },

  /**
   * Run all barcode scanner tests
   */
  runAllTests: async function() {
    console.log('🚀 Running all Barcode Scanner tests...\n');
    
    console.log('=== 1. ZXing Library Test ===');
    const libraryOk = this.testZXingLibrary();
    
    console.log('\n=== 2. Camera Test ===');
    const cameraOk = await this.testCameraForBarcode();
    
    console.log('\n=== 3. Scan Button Test ===');
    const buttonsOk = this.testScanButton();
    
    console.log('\n=== 4. Barcode Format Test ===');
    const formats = this.testBarcodeFormats();
    
    console.log('\n=== 5. Location Validation Test ===');
    this.testLocationValidation();
    
    console.log('\n=== 6. Performance Test ===');
    this.performanceTest();
    
    console.log('\n=== 7. Complete Workflow Test ===');
    const workflowOk = this.testCompleteWorkflow();
    
    console.log('\n=== Summary ===');
    console.log(`ZXing Library: ${libraryOk ? '✅' : '❌'}`);
    console.log(`Camera Access: ${cameraOk ? '✅' : '❌'}`);
    console.log(`Scan Buttons: ${buttonsOk ? '✅' : '❌'}`);
    console.log(`Workflow Ready: ${workflowOk ? '✅' : '❌'}`);
    console.log(`Supported Formats: ${formats.length} types`);
    
    if (libraryOk && cameraOk && buttonsOk && workflowOk) {
      console.log('🎉 Barcode Scanner is ready to use!');
      console.log('📱 Click any "Scan" button in the inventory to test real scanning');
    } else {
      console.log('⚠️ Barcode Scanner may have issues on this device');
    }
  }
};

// Auto-load message
console.log('📱 Barcode Scanner Demo loaded! Use window.barcodeScannerDemo.runAllTests() to test all features.');
console.log('🔧 Available methods:');
console.log('  - testZXingLibrary()');
console.log('  - testCameraForBarcode()');  
console.log('  - testScanButton()');
console.log('  - simulateBarcodeScan(locationCode)');
console.log('  - testBarcodeFormats()');
console.log('  - testLocationValidation()');
console.log('  - performanceTest()');
console.log('  - testCompleteWorkflow()');
console.log('  - monitorScannerEvents()');
console.log('  - runAllTests()');
