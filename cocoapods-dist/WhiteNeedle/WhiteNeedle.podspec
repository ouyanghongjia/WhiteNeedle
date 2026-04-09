Pod::Spec.new do |s|
  s.name             = 'WhiteNeedle'
  s.version          = '2.0.0'
  s.summary          = 'WhiteNeedle JavaScriptCore engine, TCP/Bonjour bridge, and hook utilities for iOS.'
  s.description      = <<-DESC
    WhiteNeedle is an iOS dynamic scripting engine built on JavaScriptCore.
    It exposes ObjC runtime manipulation, method hooking, Block bridging,
    and native memory helpers — all without JIT or RWX memory. Integrates
    via CocoaPods for source-level debugging and customisation.
  DESC
  s.homepage         = 'https://github.com/user/WhiteNeedle'
  s.license          = { :type => 'MIT' }
  s.author           = { 'WhiteNeedle Team' => 'whiteneedle@example.com' }

  # ── Source Configuration ──────────────────────────────────────────────
  # Option A: Private git repo (recommended for team distribution)
  #   Push this directory to a private git repo, then update the URL:
  #   s.source = { :git => 'git@your-server.com:ios/WhiteNeedle.git', :tag => s.version.to_s }
  #
  # Option B: Local path (for development / quick testing)
  #   In your Podfile, use:
  #   pod 'WhiteNeedle', :path => '/path/to/dist/cocoapods/WhiteNeedle'
  # ─────────────────────────────────────────────────────────────────────
  s.source           = { :git => 'REPLACE_WITH_YOUR_GIT_URL', :tag => s.version.to_s }

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
