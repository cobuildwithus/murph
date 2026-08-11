#!/usr/bin/env bash

source scripts/review-gpt.config.sh

browser_binary_path="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
managed_browser_user_data_dir="$HOME/Library/Application Support/BraveSoftware/Brave-Browser"
managed_browser_profile="Default"
managed_browser_port="9452"
managed_browser_background_mode="balanced"
attach_artifacts=0
