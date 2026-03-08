/**
 * 로컬 인증 헬퍼 함수
 * 비밀번호 해싱 및 검증
 */

import bcrypt from "bcrypt";

const SALT_ROUNDS = 10;

/**
 * 비밀번호 해싱
 * @param password 평문 비밀번호
 * @returns 해싱된 비밀번호
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * 비밀번호 검증
 * @param password 평문 비밀번호
 * @param hashedPassword 해싱된 비밀번호
 * @returns 비밀번호 일치 여부
 */
export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}
