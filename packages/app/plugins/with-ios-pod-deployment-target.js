const { withPodfile } = require("expo/config-plugins");

// Xcode 27 rejects pod targets below iOS 15 as errors (RNSVG, SDWebImage, and AsyncStorage's
// resource bundles still declare 9.0–13.4). Raise them to React Native 0.81's minimum.
const MINIMUM_IOS = "15.1";
const MARKER = "# paseo: raise pod deployment targets";

function withIosPodDeploymentTarget(config) {
  return withPodfile(config, (modConfig) => {
    const podfile = modConfig.modResults.contents;
    if (podfile.includes(MARKER)) return modConfig;
    const anchor = "  post_install do |installer|\n";
    if (!podfile.includes(anchor)) {
      throw new Error("Could not raise pod deployment targets: Podfile has no post_install block");
    }
    const patch = `${anchor}    ${MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build|
        current = build.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if current.nil? || Gem::Version.new(current) < Gem::Version.new('${MINIMUM_IOS}')
          build.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${MINIMUM_IOS}'
        end
      end
    end
`;
    modConfig.modResults.contents = podfile.replace(anchor, patch);
    return modConfig;
  });
}

module.exports = withIosPodDeploymentTarget;
