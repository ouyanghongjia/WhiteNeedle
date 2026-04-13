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

  # ── Auto-inject Bonjour / Local Network permissions into host App Info.plist ──
  s.script_phase = {
    :name => '[WhiteNeedle] Inject Network Permissions',
    :script => <<-'SCRIPT',
      PLIST="${BUILT_PRODUCTS_DIR}/${INFOPLIST_PATH}"
      if [ ! -f "$PLIST" ]; then
        PLIST="${TARGET_BUILD_DIR}/${INFOPLIST_PATH}"
      fi
      if [ ! -f "$PLIST" ]; then
        echo "warning: [WhiteNeedle] Info.plist not found, skipping permission injection."
        exit 0
      fi

      BUDDY=/usr/libexec/PlistBuddy

      # NSBonjourServices — array containing _whiteneedle._tcp
      if ! $BUDDY -c "Print :NSBonjourServices" "$PLIST" 2>/dev/null | grep -q "_whiteneedle._tcp"; then
        $BUDDY -c "Add :NSBonjourServices array" "$PLIST" 2>/dev/null || true
        $BUDDY -c "Add :NSBonjourServices: string _whiteneedle._tcp" "$PLIST"
        echo "note: [WhiteNeedle] Added NSBonjourServices → _whiteneedle._tcp"
      fi

      # NSLocalNetworkUsageDescription
      if ! $BUDDY -c "Print :NSLocalNetworkUsageDescription" "$PLIST" 2>/dev/null >/dev/null; then
        $BUDDY -c "Add :NSLocalNetworkUsageDescription string 'WhiteNeedle uses the local network for remote debugging.'" "$PLIST"
        echo "note: [WhiteNeedle] Added NSLocalNetworkUsageDescription"
      fi
    SCRIPT
    :execution_position => :after_compile,
    :shell_path => '/bin/sh'
  }
end
