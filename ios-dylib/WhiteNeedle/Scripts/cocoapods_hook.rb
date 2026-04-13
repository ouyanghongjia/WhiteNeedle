# frozen_string_literal: true
#
# WhiteNeedle CocoaPods helper — injects a Build Phase into the host
# App target that auto-adds Bonjour / Local Network permissions to the
# built Info.plist on every compile.
#
# Usage (Podfile):
#
#   require_relative 'path/to/Scripts/cocoapods_hook'
#
#   post_install do |installer|
#     whiteneedle_inject_permissions(installer)
#   end
#

require 'xcodeproj'

WHITENEEDLE_PHASE_NAME = '[WhiteNeedle] Inject Network Permissions'

WHITENEEDLE_INJECT_SCRIPT = <<~'SH'
  PLIST="${BUILT_PRODUCTS_DIR}/${INFOPLIST_PATH}"
  [ -f "$PLIST" ] || { echo "warning: [WhiteNeedle] Info.plist not found, skipping."; exit 0; }

  BUDDY=/usr/libexec/PlistBuddy
  CHANGED=0

  # NSBonjourServices — ensure array contains _whiteneedle._tcp
  if ! $BUDDY -c "Print :NSBonjourServices" "$PLIST" 2>/dev/null | grep -q "_whiteneedle._tcp"; then
    $BUDDY -c "Add :NSBonjourServices array" "$PLIST" 2>/dev/null || true
    $BUDDY -c "Add :NSBonjourServices: string _whiteneedle._tcp" "$PLIST"
    CHANGED=1
  fi

  # NSLocalNetworkUsageDescription
  if ! $BUDDY -c "Print :NSLocalNetworkUsageDescription" "$PLIST" 2>/dev/null >/dev/null; then
    $BUDDY -c "Add :NSLocalNetworkUsageDescription string WhiteNeedle uses the local network for remote debugging." "$PLIST"
    CHANGED=1
  fi

  # Restore binary plist format to avoid Xcode IDEPlistDocument errors
  if [ "$CHANGED" -eq 1 ]; then
    plutil -convert binary1 "$PLIST"
    echo "note: [WhiteNeedle] Injected Bonjour permissions into Info.plist"
  fi
SH

def whiteneedle_inject_permissions(installer)
  count = 0

  installer.aggregate_targets.each do |aggregate_target|
    aggregate_target.user_targets.each do |user_target|
      next unless user_target.product_type == 'com.apple.product-type.application'

      # Remove stale phase if present, then (re-)create
      user_target.shell_script_build_phases
                 .select { |p| p.name == WHITENEEDLE_PHASE_NAME }
                 .each { |p| user_target.build_phases.delete(p) }

      phase = user_target.new_shell_script_build_phase(WHITENEEDLE_PHASE_NAME)
      phase.shell_script = WHITENEEDLE_INJECT_SCRIPT
      phase.shell_path   = '/bin/sh'

      # Move to right after "Copy Bundle Resources" so it runs before signing
      copy_res = user_target.build_phases.find { |p| p.is_a?(Xcodeproj::Project::Object::PBXResourcesBuildPhase) }
      if copy_res
        idx = user_target.build_phases.index(copy_res)
        user_target.build_phases.move(phase, idx + 1)
      end

      count += 1
    end

    aggregate_target.user_project.save
  end

  Pod::UI.puts "[WhiteNeedle] Added network permission build phase to #{count} app target(s)."
end
