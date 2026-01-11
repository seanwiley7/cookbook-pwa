//
//  Item.swift
//  S&L Cookbook
//
//  Created by Sean Wiley on 1/10/26.
//

import Foundation
import SwiftData

@Model
final class Item {
    var timestamp: Date
    
    init(timestamp: Date) {
        self.timestamp = timestamp
    }
}
