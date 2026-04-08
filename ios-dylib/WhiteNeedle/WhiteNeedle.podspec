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

  s.source_files     = 'Sources/**/*.{h,hpp,m,mm,c,cpp,S}'
  s.exclude_files    = 'Sources/libffi/src/dlmalloc.c',
                       'Sources/libffi/src/debug.c',
                       'Sources/libffi/src/java_raw_api.c',
                       'Sources/libffi/src/raw_api.c'
  s.public_header_files = 'Sources/*.h'

  s.frameworks       = 'Foundation', 'UIKit', 'JavaScriptCore', 'Security', 'WebKit'
  s.libraries        = 'c++', 'sqlite3'
  s.xcconfig         = { 'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17' }
  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"${PODS_TARGET_SRCROOT}/Sources/libffi/include" "${PODS_TARGET_SRCROOT}/Sources/libffi/src"'
  }
end
