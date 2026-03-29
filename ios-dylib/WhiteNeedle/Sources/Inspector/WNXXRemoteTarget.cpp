/*
 * WNXXRemoteTarget.cpp — Pure-virtual destructor linkage
 *
 * We never instantiate RemoteControllableTarget ourselves, but the
 * pure-virtual destructor requires an out-of-line definition for the
 * linker.
 */

#include "WNXXRemoteTarget.hpp"

namespace WN {

RemoteControllableTarget::~RemoteControllableTarget() {}

} /* namespace WN */
