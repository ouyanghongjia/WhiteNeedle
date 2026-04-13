# frozen_string_literal: true
#
# WhiteNeedle CocoaPods helper — auto-injects Bonjour / Local Network
# permissions into the host App's Info.plist at `pod install` time.
#
# Usage (Podfile):
#
#   require_relative 'path/to/WhiteNeedle/Scripts/cocoapods_hook'
#
#   post_install do |installer|
#     whiteneedle_inject_permissions(installer)
#   end
#

require 'xcodeproj'

WHITENEEDLE_BONJOUR_SERVICE = '_whiteneedle._tcp'
WHITENEEDLE_NETWORK_DESC    = 'WhiteNeedle uses the local network for remote debugging.'
WHITENEEDLE_PHASE_NAME      = '[WhiteNeedle] Inject Network Permissions'

WHITENEEDLE_INJECT_SCRIPT = <<~'SH'
  PLIST="${BUILT_PRODUCTS_DIR}/${INFOPLIST_PATH}"
  [ -f "$PLIST" ] || PLIST="${TARGET_BUILD_DIR}/${INFOPLIST_PATH}"
  [ -f "$PLIST" ] || { echo "warning: [WhiteNeedle] Info.plist not found, skipping."; exit 0; }

  BUDDY=/usr/libexec/PlistBuddy

  if ! $BUDDY -c "Print :NSBonjourServices" "$PLIST" 2>/dev/null | grep -q "_whiteneedle._tcp"; then
    $BUDDY -c "Add :NSBonjourServices array" "$PLIST" 2>/dev/null || true
    $BUDDY -c "Add :NSBonjourServices: string _whiteneedle._tcp" "$PLIST"
    echo "note: [WhiteNeedle] Added NSBonjourServices → _whiteneedle._tcp"
  fi

  if ! $BUDDY -c "Print :NSLocalNetworkUsageDescription" "$PLIST" 2>/dev/null >/dev/null; then
    $BUDDY -c "Add :NSLocalNetworkUsageDescription string 'WhiteNeedle uses the local network for remote debugging.'" "$PLIST"
    echo "note: [WhiteNeedle] Added NSLocalNetworkUsageDescription"
  fi
SH

def whiteneedle_inject_permissions(installer)
  installer.aggregate_targets.each do |aggregate_target|
    aggregate_target.user_targets.each do |user_target|
      next unless user_target.product_type == 'com.apple.product-type.application'

      existing = user_target.shell_script_build_phases.find { |p| p.name == WHITENEEDLE_PHASE_NAME }
      if existing
        existing.shell_script = WHITENEEDLE_INJECT_SCRIPT
      else
        phase = user_target.new_shell_script_build_phase(WHITENEEDLE_PHASE_NAME)
        phase.shell_script = WHITENEEDLE_INJECT_SCRIPT
        phase.shell_path = '/bin/sh'
      end
    end

    aggregate_target.user_project.save
  end

  Pod::UI.puts "[WhiteNeedle] Injected network permission build phase into app target(s)."
end
