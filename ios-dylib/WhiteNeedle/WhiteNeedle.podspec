Pod::Spec.new do |s|
  s.name             = 'WhiteNeedle'
  s.version          = '2.0.0'
  s.summary          = 'WhiteNeedle JavaScriptCore engine, TCP/Bonjour bridge, and hook utilities for iOS.'
  s.description      = <<-DESC
    Local development pod wrapping ios-dylib sources. Link into an app to debug
    WhiteNeedle implementation with breakpoints in the pod target.
  DESC
  s.homepage         = 'https://github.com/bigwhite/WhiteNeedle'
  s.license          = { :type => 'MIT' }
  s.author           = { 'WhiteNeedle' => 'local@localhost' }
  s.source           = { :git => 'https://example.com/WhiteNeedle.git', :tag => s.version.to_s }

  s.platform         = :ios, '15.0'
  s.requires_arc     = true

  s.source_files     = 'Sources/**/*.{h,hpp,m,mm,c,cpp}'
  s.public_header_files = 'Sources/*.h', 'Sources/Inspector/WNInspectorBridge.h', 'Sources/Inspector/WNInspectorServer.h'

  s.frameworks       = 'Foundation', 'UIKit', 'JavaScriptCore', 'Security'
  s.libraries        = 'c++'
  s.xcconfig         = { 'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17' }
end
