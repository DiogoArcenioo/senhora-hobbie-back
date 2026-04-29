import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import nodemailer, { type Transporter } from 'nodemailer';
import { ILike, IsNull, Repository } from 'typeorm';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordResetToken } from './entities/password-reset-token.entity';

const RESET_PASSWORD_RESPONSE = {
  message:
    'Se o e-mail estiver cadastrado, enviaremos um link para redefinir sua senha.',
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private smtpTransporter: Transporter | null | undefined;

  constructor(
    @InjectRepository(Usuario)
    private readonly usuariosRepository: Repository<Usuario>,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetTokensRepository: Repository<PasswordResetToken>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(loginDto: LoginDto) {
    const email = loginDto.email.trim();

    const usuario = await this.usuariosRepository.findOne({
      where: { email: ILike(email) },
    });

    if (!usuario || !usuario.senha_hash || !usuario.ativo) {
      throw new UnauthorizedException('Credenciais invalidas');
    }

    const senhaValida = await this.validarSenha(loginDto.senha, usuario);

    if (!senhaValida) {
      throw new UnauthorizedException('Credenciais invalidas');
    }

    const payload = {
      sub: usuario.id,
      email: usuario.email,
      tipo: usuario.tipo,
    };

    return {
      access_token: await this.jwtService.signAsync(payload),
      token_type: 'Bearer',
      user: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        tipo: usuario.tipo,
      },
    };
  }

  async forgotPassword(
    forgotPasswordDto: ForgotPasswordDto,
    requestContext: { ip?: string; userAgent?: string } = {},
  ) {
    const email = forgotPasswordDto.email.trim();
    const usuario = await this.usuariosRepository.findOne({
      where: { email: ILike(email) },
    });

    if (!usuario || !usuario.ativo || !usuario.senha_hash) {
      return RESET_PASSWORD_RESPONSE;
    }

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + this.getResetTokenTtlMs());
    const resetUrl = this.buildResetPasswordUrl(rawToken);

    await this.passwordResetTokensRepository.update(
      {
        usuario_id: usuario.id,
        consumed_at: IsNull(),
      },
      {
        consumed_at: new Date(),
      },
    );

    const resetToken = this.passwordResetTokensRepository.create({
      usuario_id: usuario.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      consumed_at: null,
      requested_ip: this.truncateOptional(requestContext.ip, 80),
      requested_user_agent: this.truncateOptional(
        requestContext.userAgent,
        300,
      ),
    });

    await this.passwordResetTokensRepository.save(resetToken);

    try {
      await this.sendPasswordResetEmail({
        to: usuario.email,
        nome: usuario.nome,
        resetUrl,
        expiresAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falha ao enviar e-mail de reset de senha: ${message}`);
    }

    return RESET_PASSWORD_RESPONSE;
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const token = resetPasswordDto.token.trim();
    const novaSenha = resetPasswordDto.senha.trim();

    if (!token || novaSenha.length < 8) {
      throw new BadRequestException('Link invalido ou senha invalida');
    }

    const tokenHash = this.hashResetToken(token);
    const now = new Date();

    await this.usuariosRepository.manager.transaction(async (manager) => {
      const resetToken = await manager.findOne(PasswordResetToken, {
        where: { token_hash: tokenHash },
      });

      if (
        !resetToken ||
        resetToken.consumed_at ||
        resetToken.expires_at.getTime() <= now.getTime()
      ) {
        throw new BadRequestException(
          'Link de redefinicao invalido ou expirado. Solicite um novo reset de senha.',
        );
      }

      const usuario = await manager.findOne(Usuario, {
        where: { id: resetToken.usuario_id },
      });

      if (!usuario || !usuario.ativo) {
        throw new BadRequestException(
          'Link de redefinicao invalido ou expirado. Solicite um novo reset de senha.',
        );
      }

      usuario.senha_hash = await hash(novaSenha, 10);
      await manager.save(Usuario, usuario);
      await manager.update(
        PasswordResetToken,
        {
          usuario_id: usuario.id,
          consumed_at: IsNull(),
        },
        {
          consumed_at: now,
        },
      );
    });

    return {
      message: 'Senha redefinida com sucesso. Voce ja pode fazer login.',
    };
  }

  private async validarSenha(
    senhaInformada: string,
    usuario: Usuario,
  ): Promise<boolean> {
    const senhaHash = usuario.senha_hash;

    if (!senhaHash) {
      return false;
    }

    if (this.isBcryptHash(senhaHash)) {
      return compare(senhaInformada, senhaHash);
    }

    if (senhaInformada !== senhaHash) {
      return false;
    }

    usuario.senha_hash = await hash(senhaInformada, 10);
    await this.usuariosRepository.save(usuario);

    return true;
  }

  private isBcryptHash(senhaHash: string): boolean {
    return (
      senhaHash.startsWith('$2a$') ||
      senhaHash.startsWith('$2b$') ||
      senhaHash.startsWith('$2y$')
    );
  }

  private hashResetToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private getResetTokenTtlMs(): number {
    const rawMinutes = Number(
      this.configService.get<string>('PASSWORD_RESET_TOKEN_TTL_MINUTES', '60'),
    );
    const minutes =
      Number.isFinite(rawMinutes) && rawMinutes > 0 ? rawMinutes : 60;

    return Math.min(minutes, 24 * 60) * 60 * 1000;
  }

  private buildResetPasswordUrl(token: string): string {
    const frontendUrl = this.configService
      .get<string>('FRONTEND_URL', 'http://localhost:3000')
      .trim()
      .replace(/\/+$/, '');
    const url = new URL('/resetar-senha', frontendUrl);
    url.searchParams.set('token', token);

    return url.toString();
  }

  private async sendPasswordResetEmail(params: {
    to: string;
    nome: string;
    resetUrl: string;
    expiresAt: Date;
  }): Promise<void> {
    const transporter = this.getSmtpTransporter();
    const expiresAtFormatted = new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    }).format(params.expiresAt);

    if (!transporter) {
      const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');

      if (nodeEnv.toLowerCase() === 'production') {
        throw new Error('SMTP nao configurado para envio de reset de senha');
      }

      this.logger.warn(
        `SMTP nao configurado. Link de reset para ${params.to}: ${params.resetUrl}`,
      );
      return;
    }

    const from =
      this.configService.get<string>('MAIL_FROM')?.trim() ||
      this.configService.get<string>('SMTP_FROM')?.trim() ||
      this.configService.get<string>('SMTP_USER')?.trim() ||
      'Clube das Jovens Senhoras <no-reply@localhost>';

    await transporter.sendMail({
      from,
      to: params.to,
      subject: 'Redefinicao de senha - Clube das Jovens Senhoras',
      text: [
        `Ola, ${params.nome}.`,
        '',
        'Recebemos uma solicitacao para redefinir sua senha.',
        `Acesse o link abaixo ate ${expiresAtFormatted}:`,
        params.resetUrl,
        '',
        'Se voce nao solicitou essa alteracao, ignore este e-mail.',
      ].join('\n'),
      html: this.buildPasswordResetEmailHtml({
        nome: params.nome,
        resetUrl: params.resetUrl,
        expiresAtFormatted,
      }),
    });
  }

  private getSmtpTransporter(): Transporter | null {
    if (this.smtpTransporter !== undefined) {
      return this.smtpTransporter;
    }

    const host = this.configService.get<string>('SMTP_HOST')?.trim();

    if (!host) {
      this.smtpTransporter = null;
      return this.smtpTransporter;
    }

    const rawPort = Number(this.configService.get<string>('SMTP_PORT', '587'));
    const port = Number.isFinite(rawPort) ? rawPort : 587;
    const user = this.configService.get<string>('SMTP_USER')?.trim();
    const pass = this.configService.get<string>('SMTP_PASS')?.trim();
    const secure =
      this.configService.get<string>('SMTP_SECURE') === 'true' || port === 465;

    this.smtpTransporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    });

    return this.smtpTransporter;
  }

  private buildPasswordResetEmailHtml(params: {
    nome: string;
    resetUrl: string;
    expiresAtFormatted: string;
  }): string {
    return `
      <div style="font-family: Arial, sans-serif; color: #61171d; line-height: 1.5;">
        <h1 style="color: #a81921; font-size: 22px;">Redefinir senha</h1>
        <p>Ola, ${this.escapeHtml(params.nome)}.</p>
        <p>Recebemos uma solicitacao para redefinir sua senha.</p>
        <p>
          <a href="${this.escapeHtml(params.resetUrl)}" style="background: #a81921; color: #ffffff; display: inline-block; padding: 10px 16px; border-radius: 999px; text-decoration: none; font-weight: 700;">
            Criar nova senha
          </a>
        </p>
        <p>Este link expira em ${this.escapeHtml(params.expiresAtFormatted)}.</p>
        <p>Se voce nao solicitou essa alteracao, ignore este e-mail.</p>
      </div>
    `;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private truncateOptional(value: string | undefined, maxLength: number) {
    const normalized = value?.trim();

    if (!normalized) {
      return null;
    }

    return normalized.slice(0, maxLength);
  }
}
